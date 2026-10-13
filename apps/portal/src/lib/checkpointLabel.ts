import QRCode from 'qrcode';

export interface LabelCheckpoint { id: string; name: string; code: string }
export interface CheckpointLabel extends LabelCheckpoint { image: string; file: File }

function wrapText(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const character of text) {
    if (line && context.measureText(line + character).width > width) { lines.push(line); line = ''; }
    line += character;
  }
  if (line) lines.push(line);
  return lines;
}

export async function createCheckpointLabel(checkpoint: LabelCheckpoint): Promise<CheckpointLabel> {
  const qr = document.createElement('canvas');
  await QRCode.toCanvas(qr, checkpoint.code, { width: 840, margin: 4, errorCorrectionLevel: 'M' });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not generate the QR image. Try Safari or Chrome.');
  context.font = 'bold 52px Arial, sans-serif';
  const names = wrapText(context, checkpoint.name, 880);
  context.font = '36px monospace';
  const codes = wrapText(context, checkpoint.code, 880);
  canvas.width = 1000;
  canvas.height = 1030 + names.length * 64 + codes.length * 46;
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#4E4456';
  context.lineWidth = 4;
  context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  context.fillStyle = '#4E4456';
  context.textAlign = 'center';
  context.font = 'bold 32px Arial, sans-serif';
  context.fillText('MUSCAT BAY · SECURITY PATROL', 500, 65);
  context.drawImage(qr, 80, 90);
  context.font = 'bold 52px Arial, sans-serif';
  names.forEach((line, index) => context.fillText(line, 500, 975 + index * 64));
  context.font = '36px monospace';
  codes.forEach((line, index) => context.fillText(line, 500, 975 + names.length * 64 + index * 46));
  context.font = '25px Arial, sans-serif';
  context.fillText('Scan with MB Patrol at this location', 500, canvas.height - 35);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not save the QR image. Please try again.')), 'image/png'));
  const filename = `MB-Patrol-${checkpoint.code.replace(/[^\p{L}\p{N}_.-]/gu, '_').slice(0, 100)}.png`;
  return { ...checkpoint, image: canvas.toDataURL('image/png'), file: new File([blob], filename, { type: 'image/png' }) };
}
