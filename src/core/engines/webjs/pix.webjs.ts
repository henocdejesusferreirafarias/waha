import {
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ensureSuffix } from '@waha/core/abc/session.abc';
import { isJidCus, isLidUser } from '@waha/core/utils/jids';
import type {
  PixKeyType,
  SendPixRequest,
} from '@waha/structures/chatting.dto';
import { generatePrefixedId } from '@waha/utils/ids';
import type { Page } from 'puppeteer';

interface PixWebjsClient<TResult> {
  pupPage: Pick<Page, 'evaluate'>;
  sendMessage(
    chatId: string,
    content: string,
    options: { extra: PixInteractiveMessage },
  ): Promise<TResult>;
}

export interface PixInteractiveMessage {
  type: 'interactive';
  caption: '';
  nativeFlowName: 'payment_info';
  interactiveType: 'native_flow';
  interactivePayload: {
    buttons: Array<{ buttonParamsJson: string; name: 'payment_info' }>;
    messageVersion: 1;
  };
  messageSecret: Uint8Array;
}

export function installPixMessageSecretRehydratorInPage(): void {
  interface PageSendOptions {
    extraOptions?: Record<string, unknown>;
  }
  interface PageWWebJS {
    __wahaPixMessageSecretRehydrator?: boolean;
    sendMessage(
      chat: unknown,
      content: unknown,
      options?: PageSendOptions,
    ): Promise<unknown>;
  }

  const pageWindow = window as unknown as { WWebJS: PageWWebJS };
  const wwebjs = pageWindow.WWebJS;
  if (wwebjs.__wahaPixMessageSecretRehydrator) return;

  const originalSendMessage = wwebjs.sendMessage;
  wwebjs.sendMessage = async (chat, content, options = {}) => {
    const extra = options.extraOptions;
    const secret = extra?.messageSecret;
    if (
      extra?.nativeFlowName === 'payment_info' &&
      secret &&
      !(secret instanceof Uint8Array)
    ) {
      const bytes = Object.values(secret);
      if (
        bytes.length !== 32 ||
        !bytes.every(
          (byte) => Number.isInteger(byte) && Number(byte) >= 0 && Number(byte) <= 255,
        )
      ) {
        throw new Error('Invalid PIX message secret');
      }
      extra.messageSecret = Uint8Array.from(bytes.map(Number));
    }
    return originalSendMessage(chat, content, options);
  };
  wwebjs.__wahaPixMessageSecretRehydrator = true;
}

export async function ensurePixChatInPage(chatId: string): Promise<string> {
  let wid = window.require('WAWebWidFactory').createWid(chatId);
  if (chatId.endsWith('@c.us')) {
    const exists = await window
      .require('WAWebQueryExistsJob')
      .queryWidExists(wid);
    if (!exists?.wid) {
      throw new Error('PIX destination is not registered in WhatsApp');
    }
    wid = exists.wid;
  }
  const result = await window
    .require('WAWebFindChatAction')
    .findOrCreateLatestChat(wid, 'createChat');
  if (!result?.chat?.id) {
    throw new Error('Failed to materialize PIX chat');
  }
  const chat = window.require('WAWebCollections').Chat.get(result.chat.id);
  if (!chat) {
    throw new Error('Materialized PIX chat is missing from the chat store');
  }
  return chat.id.toString();
}

export function assertPixDirectChatId(chatId: string): string {
  const normalized = ensureSuffix(chatId);
  if (!isJidCus(normalized) && !isLidUser(normalized)) {
    throw new UnprocessableEntityException(
      'PIX can only be sent to a direct chat',
    );
  }
  return normalized;
}

export function validatePixKey(type: PixKeyType, value: string): boolean {
  const key = value.trim();
  if (type === 'CPF') return validateBrazilianDocument(key, 11);
  if (type === 'CNPJ') return validateBrazilianDocument(key, 14);
  if (type === 'PHONE') return /^\+[1-9]\d{7,14}$/.test(key);
  if (type === 'EMAIL') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    key,
  );
}

function validateBrazilianDocument(value: string, length: 11 | 14): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== length || /^(\d)\1+$/.test(digits)) return false;
  if (length === 11) {
    return (
      cpfDigit(digits.slice(0, 9), 10) === Number(digits[9]) &&
      cpfDigit(digits.slice(0, 10), 11) === Number(digits[10])
    );
  }
  return (
    cnpjDigit(digits.slice(0, 12)) === Number(digits[12]) &&
    cnpjDigit(digits.slice(0, 13)) === Number(digits[13])
  );
}

function cpfDigit(base: string, weight: number): number {
  const sum = [...base].reduce(
    (total, digit, index) => total + Number(digit) * (weight - index),
    0,
  );
  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}

function cnpjDigit(base: string): number {
  let weight = base.length - 7;
  const sum = [...base].reduce((total, digit) => {
    const next = total + Number(digit) * weight;
    weight -= 1;
    if (weight === 1) weight = 9;
    return next;
  }, 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function buildPixExtra(
  request: SendPixRequest,
  messageSecret: Uint8Array,
): PixInteractiveMessage {
  const referenceId = generatePrefixedId('pix');
  const buttonParams = {
    order: {
      items: [
        {
          name: '',
          retailer_id: `custom-item-${referenceId}`,
          amount: { offset: 1, value: 0 },
          quantity: 0,
        },
      ],
      order_type: 'ORDER_WITHOUT_AMOUNT',
      status: 'payment_requested',
      subtotal: { value: 0, offset: 1 },
    },
    total_amount: { value: 0, offset: 1 },
    reference_id: referenceId,
    payment_settings: [
      {
        type: 'pix_static_code',
        pix_static_code: {
          key_type: request.keyType,
          merchant_name: request.name.trim(),
          key: request.key.trim(),
        },
      },
      { type: 'cards', cards: { enabled: false } },
    ],
    external_payment_configurations: [
      {
        payment_instruction: request.instructions?.trim() ?? '',
        type: 'payment_instruction',
      },
    ],
    additional_note: '',
    currency: 'BRL',
    type: 'physical-goods',
  };
  return {
    type: 'interactive',
    caption: '',
    nativeFlowName: 'payment_info',
    interactiveType: 'native_flow',
    interactivePayload: {
      buttons: [
        {
          buttonParamsJson: JSON.stringify(buttonParams),
          name: 'payment_info',
        },
      ],
      messageVersion: 1,
    },
    messageSecret: messageSecret,
  };
}

export async function sendPixWebjs<TResult>(
  client: PixWebjsClient<TResult>,
  request: SendPixRequest,
): Promise<TResult> {
  const chatId = assertPixDirectChatId(request.chatId);
  if (!request.name.trim() || !validatePixKey(request.keyType, request.key)) {
    throw new UnprocessableEntityException('Invalid PIX key for keyType');
  }
  let phase = 'prepare_chat';
  try {
    const canonicalChatId = await client.pupPage.evaluate(
      ensurePixChatInPage,
      chatId,
    );
    phase = 'install_secret_rehydrator';
    await client.pupPage.evaluate(installPixMessageSecretRehydratorInPage);
    phase = 'generate_secret';
    const bytes = await client.pupPage.evaluate(() =>
      Array.from(self.crypto.getRandomValues(new Uint8Array(32))),
    );
    const extra = buildPixExtra(request, Uint8Array.from(bytes));
    phase = 'dispatch';
    return await client.sendMessage(canonicalChatId, '', { extra: extra });
  } catch {
    throw new InternalServerErrorException(`Failed to send PIX (${phase})`);
  }
}
