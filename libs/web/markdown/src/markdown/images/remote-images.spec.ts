import { RemoteImages } from './remote-images';

describe('RemoteImages', () => {
  const texts = () => ({ button: 'Show remote images', note: 'Loading them lets these sites see your IP address.' });

  it('puts one button with its note at the top of a block, and moves it', () => {
    const shown: number[] = [];
    const remote = new RemoteImages(texts, () => shown.push(1));
    const first = document.createElement('div');
    first.innerHTML = '<p>a</p>';
    const second = document.createElement('div');

    remote.place(second);
    remote.place(first);

    expect(second.children).toHaveLength(0);
    expect(first.firstElementChild?.textContent).toBe(
      'Show remote imagesLoading them lets these sites see your IP address.'
    );
    expect(first.querySelectorAll('button')).toHaveLength(1);
    expect(shown).toEqual([]);
  });

  it('shows the images and removes the button when clicked, until reset', () => {
    const shown: number[] = [];
    const remote = new RemoteImages(texts, () => shown.push(1));
    const block = document.createElement('div');
    remote.place(block);

    block.querySelector('button')?.click();

    expect(remote.shown()).toBe(true);
    expect(shown).toEqual([ 1 ]);
    expect(block.children).toHaveLength(0);
    remote.place(block);
    expect(block.children).toHaveLength(0);
    remote.reset();
    remote.place(block);
    expect(remote.shown()).toBe(false);
    expect(block.querySelectorAll('button')).toHaveLength(1);
  });

  it('removes the button when no block holds a remote image', () => {
    const remote = new RemoteImages(texts, () => undefined);
    const block = document.createElement('div');
    remote.place(block);

    remote.place(null);

    expect(block.children).toHaveLength(0);
  });
});
