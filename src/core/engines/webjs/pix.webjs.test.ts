import {
  assertPixDirectChatId,
  buildPixExtra,
  ensurePixChatInPage,
  installPixMessageSecretRehydratorInPage,
  sendPixWebjs,
  validatePixKey,
} from './pix.webjs';

describe('WEBJS PIX', () => {
  it('rehydrates only native PIX message secrets inside the page', async () => {
    interface TestSendOptions {
      extraOptions: {
        nativeFlowName: string;
        messageSecret: object | Uint8Array;
      };
    }
    const originalSendMessage = jest.fn(
      async (_chat: string, _content: string, _options: TestSendOptions) =>
        'sent',
    );
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        WWebJS: { sendMessage: originalSendMessage },
      },
    });

    try {
      installPixMessageSecretRehydratorInPage();
      const serializedSecret = Object.fromEntries(
        Array.from({ length: 32 }, (_, index) => [index, index]),
      );
      const options = {
        extraOptions: {
          nativeFlowName: 'payment_info',
          messageSecret: serializedSecret,
        },
      };

      const pageWindow = window as unknown as {
        WWebJS: {
          sendMessage(
            chat: string,
            content: string,
            sendOptions: TestSendOptions,
          ): Promise<string>;
        };
      };
      await pageWindow.WWebJS.sendMessage('chat', '', options);

      const forwarded = originalSendMessage.mock.calls[0][2];
      expect(forwarded.extraOptions.messageSecret).toEqual(
        Uint8Array.from({ length: 32 }, (_, index) => index),
      );
    } finally {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  it('materializes a new chat with the required createChat origin', async () => {
    const wid = { toString: () => '123@lid' };
    const chat = { id: wid };
    const createWid = jest.fn(() => wid);
    const findOrCreateLatestChat = jest.fn(async () => ({ chat: { id: wid } }));
    const get = jest.fn(() => chat);
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        require: (module: string) => {
          if (module === 'WAWebWidFactory') return { createWid: createWid };
          if (module === 'WAWebFindChatAction') {
            return { findOrCreateLatestChat: findOrCreateLatestChat };
          }
          if (module === 'WAWebCollections') return { Chat: { get: get } };
          throw new Error(`Unexpected module: ${module}`);
        },
      },
    });

    try {
      await expect(ensurePixChatInPage('123@lid')).resolves.toBe('123@lid');
    } finally {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
    }

    expect(createWid).toHaveBeenCalledWith('123@lid');
    expect(findOrCreateLatestChat).toHaveBeenCalledWith(wid, 'createChat');
    expect(get).toHaveBeenCalledWith(wid);
  });

  it('resolves a phone-number JID to LID before materializing the chat', async () => {
    const phoneWid = { toString: () => '5511999999999@c.us' };
    const lidWid = { toString: () => '456@lid' };
    const createWid = jest.fn(() => phoneWid);
    const queryWidExists = jest.fn(async () => ({ wid: lidWid }));
    const findOrCreateLatestChat = jest.fn(async () => ({
      chat: { id: lidWid },
    }));
    const get = jest.fn(() => ({ id: lidWid }));
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        require: (module: string) => {
          if (module === 'WAWebWidFactory') return { createWid: createWid };
          if (module === 'WAWebQueryExistsJob') {
            return { queryWidExists: queryWidExists };
          }
          if (module === 'WAWebFindChatAction') {
            return { findOrCreateLatestChat: findOrCreateLatestChat };
          }
          if (module === 'WAWebCollections') return { Chat: { get: get } };
          throw new Error(`Unexpected module: ${module}`);
        },
      },
    });

    try {
      await expect(
        ensurePixChatInPage('5511999999999@c.us'),
      ).resolves.toBe('456@lid');
    } finally {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
    }

    expect(queryWidExists).toHaveBeenCalledWith(phoneWid);
    expect(findOrCreateLatestChat).toHaveBeenCalledWith(lidWid, 'createChat');
    expect(get).toHaveBeenCalledWith(lidWid);
  });

  it.each([
    ['5511999999999', '5511999999999@c.us'],
    ['5511999999999@c.us', '5511999999999@c.us'],
    ['123456789@lid', '123456789@lid'],
  ])('accepts a direct chat %s', (input, expected) => {
    expect(assertPixDirectChatId(input)).toBe(expected);
  });

  it.each([
    'group@g.us',
    'status@broadcast',
    'news@newsletter',
    'list@broadcast',
  ])('rejects a non-direct chat %s', (chatId) => {
    expect(() => assertPixDirectChatId(chatId)).toThrow(/direct/i);
  });

  it.each([
    ['CPF', '52998224725'],
    ['CNPJ', '11222333000181'],
    ['PHONE', '+5511999999999'],
    ['EMAIL', 'pix@example.com'],
    ['EVP', '123e4567-e89b-12d3-a456-426614174000'],
  ] as const)('accepts %s keys', (type, key) => {
    expect(validatePixKey(type, key)).toBe(true);
  });

  it.each([
    ['CPF', '11111111111'],
    ['CNPJ', '11222333000180'],
    ['PHONE', '11999999999'],
    ['EMAIL', 'invalid-email'],
    ['EVP', 'not-a-uuid'],
  ] as const)('rejects invalid %s keys', (type, key) => {
    expect(validatePixKey(type, key)).toBe(false);
  });

  it('builds payment_info without amount and disables cards', () => {
    const extra = buildPixExtra(
      {
        session: 'default',
        chatId: '123@c.us',
        keyType: 'PHONE',
        name: 'Marcelo Barbershop',
        key: '+5511999999999',
        instructions: 'Toque em Copiar.',
      },
      new Uint8Array(32).fill(7),
    );
    const params = JSON.parse(
      extra.interactivePayload.buttons[0].buttonParamsJson,
    );

    expect(extra).toMatchObject({
      type: 'interactive',
      nativeFlowName: 'payment_info',
      interactiveType: 'native_flow',
    });
    expect(params.order.order_type).toBe('ORDER_WITHOUT_AMOUNT');
    expect(params.total_amount).toEqual({ value: 0, offset: 1 });
    expect(params.currency).toBe('BRL');
    expect(params.payment_settings).toContainEqual({
      type: 'cards',
      cards: { enabled: false },
    });
    expect(params.payment_settings).toContainEqual({
      type: 'pix_static_code',
      pix_static_code: {
        key_type: 'PHONE',
        merchant_name: 'Marcelo Barbershop',
        key: '+5511999999999',
      },
    });
  });

  it('generates the secret in the page and sends one raw message', async () => {
    const evaluate = jest.fn();
    evaluate.mockImplementation(async (pageFunction) =>
      pageFunction === ensurePixChatInPage
        ? '456@lid'
        : pageFunction === installPixMessageSecretRehydratorInPage
          ? undefined
        : Array.from({ length: 32 }, (_, index) => index),
    );
    const sendMessage = jest.fn(async () => ({ id: 'message-id' }));
    const request = {
      session: 'default',
      chatId: '5511999999999@c.us',
      keyType: 'EVP' as const,
      name: 'Marcelo Barbershop',
      key: '123e4567-e89b-12d3-a456-426614174000',
    };

    await sendPixWebjs(
      {
        pupPage: { evaluate: evaluate },
        sendMessage: sendMessage,
      },
      request,
    );

    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(evaluate).toHaveBeenNthCalledWith(
      1,
      ensurePixChatInPage,
      '5511999999999@c.us',
    );
    expect(evaluate).toHaveBeenNthCalledWith(
      2,
      installPixMessageSecretRehydratorInPage,
    );
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      '456@lid',
      '',
      {
        extra: expect.objectContaining({
          messageSecret: Uint8Array.from(
            { length: 32 },
            (_, index) => index,
          ),
        }),
      },
    );
  });

  it('does not call the page or sender for invalid input', async () => {
    const evaluate = jest.fn();
    const sendMessage = jest.fn();

    await expect(
      sendPixWebjs(
        {
          pupPage: { evaluate: evaluate },
          sendMessage: sendMessage,
        },
        {
          session: 'default',
          chatId: 'group@g.us',
          keyType: 'CPF',
          name: 'Marcelo',
          key: '11111111111',
        },
      ),
    ).rejects.toThrow();
    expect(evaluate).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does not expose PIX data in validation errors', async () => {
    let error: unknown;
    try {
      await sendPixWebjs(
        {
          pupPage: { evaluate: jest.fn() },
          sendMessage: jest.fn(),
        },
        {
          session: 'default',
          chatId: 'group@g.us',
          keyType: 'PHONE',
          name: 'Marcelo Privado',
          key: '+5511999999999',
        },
      );
    } catch (caught) {
      error = caught;
    }

    expect(String(error)).not.toMatch(/\+5511999999999|Marcelo Privado/);
  });

  it('sanitizes unexpected browser or send errors', async () => {
    const evaluate = jest.fn();
    evaluate
      .mockResolvedValueOnce('123@c.us')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(new Array(32).fill(1));
    const sendMessage = jest.fn(async () => {
      throw new Error('provider leaked +5511999999999 Marcelo Privado');
    });
    let error: unknown;
    try {
      await sendPixWebjs(
        {
          pupPage: { evaluate: evaluate },
          sendMessage: sendMessage,
        },
        {
          session: 'default',
          chatId: '123@c.us',
          keyType: 'PHONE',
          name: 'Marcelo Privado',
          key: '+5511999999999',
        },
      );
    } catch (caught) {
      error = caught;
    }

    expect(String(error)).toMatch(/failed to send pix.*dispatch/i);
    expect(String(error)).not.toMatch(/\+5511999999999|Marcelo Privado/);
  });

  it('reports a safe phase when chat preparation fails', async () => {
    const evaluate = jest.fn(async () => {
      throw new Error('provider leaked +5511999999999 Marcelo Privado');
    });
    let error: unknown;
    try {
      await sendPixWebjs(
        {
          pupPage: { evaluate: evaluate },
          sendMessage: jest.fn(),
        },
        {
          session: 'default',
          chatId: '123@c.us',
          keyType: 'PHONE',
          name: 'Marcelo Privado',
          key: '+5511999999999',
        },
      );
    } catch (caught) {
      error = caught;
    }

    expect(String(error)).toMatch(/failed to send pix.*prepare_chat/i);
    expect(String(error)).not.toMatch(/\+5511999999999|Marcelo Privado/);
  });
});
