import { ChattingController } from '@waha/api/chatting.controller';

describe('ChattingController PIX', () => {
  it('delegates sendPix to the requested working session', async () => {
    const request = {
      session: 'barbershop',
      chatId: '123@c.us',
      keyType: 'PHONE' as const,
      name: 'Marcelo',
      key: '+5511999999999',
    };
    const sendPix = jest.fn(async () => ({ id: 'pix-message' }));
    const getWorkingSession = jest.fn(async () => ({ sendPix: sendPix }));
    const controller = new ChattingController({
      getWorkingSession: getWorkingSession,
    } as never);

    await expect(controller.sendPix(request)).resolves.toEqual({
      id: 'pix-message',
    });
    expect(getWorkingSession).toHaveBeenCalledWith('barbershop');
    expect(sendPix).toHaveBeenCalledWith(request);
  });
});
