import {
  assertPixDirectChatId,
  buildPixExtra,
  sendPixWebjs,
  validatePixKey,
} from './pix.webjs';

describe('WEBJS PIX', () => {
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
    const evaluate = jest.fn(async () =>
      Array.from({ length: 32 }, (_, index) => index),
    );
    const sendMessage = jest.fn(async () => ({ id: 'message-id' }));
    const request = {
      session: 'default',
      chatId: '123@lid',
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

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      '123@lid',
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
    const sendMessage = jest.fn(async () => {
      throw new Error('provider leaked +5511999999999 Marcelo Privado');
    });
    let error: unknown;
    try {
      await sendPixWebjs(
        {
          pupPage: { evaluate: jest.fn(async () => new Array(32).fill(1)) },
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

    expect(String(error)).toMatch(/failed to send pix/i);
    expect(String(error)).not.toMatch(/\+5511999999999|Marcelo Privado/);
  });
});
