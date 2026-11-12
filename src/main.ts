import { el, loadAssets, loadFont } from './assets';
import { CONFIG, EXPORT } from './config';
import { editField } from './edit';
import { Renderer } from './render';
import type { CardState, Field } from './types';
import { readHash, writeHash } from './url';

async function main(): Promise<void> {
  const canvas = el<HTMLCanvasElement>('card');
  const headerInput = el<HTMLInputElement>('header');
  const topInput = el<HTMLInputElement>('top');
  const bottomInput = el<HTMLInputElement>('bottom');
  const hint = el<HTMLParagraphElement>('hint');
  const download = el<HTMLButtonElement>('download');
  const copy = el<HTMLButtonElement>('copy');
  const share = el<HTMLButtonElement>('share');

  await loadFont();

  const assets = await loadAssets();
  const renderer = new Renderer(canvas, CONFIG, assets);

  // Every field is clamped to what the card can hold, so text never shrinks
  // and never spills off the edge.
  const initial = readHash();
  const state: CardState = {
    header: renderer.clamp(initial.header, 'header'),
    top: renderer.clamp(initial.top, 'top'),
    bottom: renderer.clamp(initial.bottom, 'bottom'),
  };
  headerInput.value = state.header;
  topInput.value = state.top;
  bottomInput.value = state.bottom;

  const paint = (): void => {
    renderer.draw(state);
    writeHash(state);
  };

  const sync = (field: Field, input: HTMLInputElement): void => {
    const raw = input.value;
    const { value, shown, atLimit } = editField(
      raw, field, (t, f) => renderer.clamp(t, f),
    );

    if (shown !== raw) {
      const caret = input.selectionStart;
      input.value = shown;
      if (caret !== null) {
        const at = Math.min(caret, shown.length);
        input.setSelectionRange(at, at);
      }
    }

    state[field] = value;
    input.toggleAttribute('aria-invalid', atLimit);
    hint.textContent = atLimit
      ? 'That line is full — no more room on the card.'
      : '';
    paint();
  };

  topInput.addEventListener('input', () => sync('top', topInput));
  bottomInput.addEventListener('input', () => sync('bottom', bottomInput));
  headerInput.addEventListener('input', () => sync('header', headerInput));

  download.addEventListener('click', async () => {
    const blob = await renderer.toBlob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = EXPORT.filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    hint.textContent = 'Saved';
  });

  copy.addEventListener('click', async () => {
    try {
      // the clipboard only accepts PNG
      const blob = await renderer.toPngBlob();
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
      hint.textContent = 'Copied to clipboard.';
    } catch {
      hint.textContent = 'Clipboard blocked — use Download instead.';
    }
  });

  if (navigator.canShare) {
    share.hidden = false;
    share.addEventListener('click', async () => {
      const blob = await renderer.toBlob();
      const file = new File([blob], EXPORT.filename,
        { type: 'image/jpeg' });
      if (!navigator.canShare({ files: [file] })) {
        hint.textContent = 'This browser cannot share files.';
        return;
      }
      await navigator.share({ files: [file], title: EXPORT.title });
    });
  }

  paint();
}

void main();
