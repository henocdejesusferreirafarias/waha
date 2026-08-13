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

interface PixWebjsClient<TResult> {
  pupPage: {
    evaluate(pageFunction: () => number[]): Promise<number[]>;
  };
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
  try {
    const bytes = await client.pupPage.evaluate(() =>
      Array.from(self.crypto.getRandomValues(new Uint8Array(32))),
    );
    const extra = buildPixExtra(request, Uint8Array.from(bytes));
    return await client.sendMessage(chatId, '', { extra: extra });
  } catch {
    throw new InternalServerErrorException('Failed to send PIX');
  }
}
