import esm from '@waha/vendor/esm';

import {
  IsEditedMessage,
  IsHistorySyncNotification,
  IsSecretEncryptedMessageEdit,
} from './pwa';

describe('proto WhatsApp utils', () => {
  const loadedModule = esm.b;

  beforeAll(() => {
    esm.b = {
      normalizeMessageContent: (message) => message,
      proto: {
        Message: {
          ProtocolMessage: {
            Type: {
              MESSAGE_EDIT: 1,
              HISTORY_SYNC_NOTIFICATION: 2,
            },
          },
          SecretEncryptedMessage: {
            SecretEncType: {
              MESSAGE_EDIT: 3,
            },
          },
        },
      },
    } as unknown as typeof esm.b;
  });

  afterAll(() => {
    esm.b = loadedModule;
  });

  it('uses the dynamically loaded Baileys module for edited messages', () => {
    const type = esm.b.proto.Message.ProtocolMessage.Type.MESSAGE_EDIT;
    const message = {
      protocolMessage: {
        type: type,
        editedMessage: { conversation: 'edited' },
      },
    };

    expect(IsEditedMessage(message)).toBe(true);
  });

  it('uses the dynamically loaded Baileys module for history sync', () => {
    const type =
      esm.b.proto.Message.ProtocolMessage.Type.HISTORY_SYNC_NOTIFICATION;
    const message = {
      protocolMessage: {
        type: type,
        historySyncNotification: {},
      },
    };

    expect(IsHistorySyncNotification(message)).toBe(true);
  });

  it('uses the dynamically loaded Baileys module for secret edits', () => {
    const type =
      esm.b.proto.Message.SecretEncryptedMessage.SecretEncType.MESSAGE_EDIT;
    const message = {
      secretEncryptedMessage: {
        secretEncType: type,
      },
    };

    expect(IsSecretEncryptedMessageEdit(message)).toBe(true);
  });
});
