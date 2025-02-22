import {prefs, storage} from './prefs.mjs';
import {log} from './utils.mjs';

// this list keeps ids of the tabs that are in progress of being discarded
const inprogress = new Set();

const discard = tab => {
  if (inprogress.has(tab.id)) {
    return;
  }

  // https://github.com/rNeomy/auto-tab-discard/issues/248
  inprogress.add(tab.id);
  setTimeout(() => inprogress.delete(tab.id), 2000);

  if (tab.active) {
    log('tab is active', tab);
    return;
  }
  if (tab.discarded) {
    log('already discarded', tab);
    return;
  }
  return storage(prefs).then(prefs => {
    if (discard.count > prefs['simultaneous-jobs'] && discard.time + 5000 < Date.now()) {
      discard.count = 0;
    }
    if (discard.count > prefs['simultaneous-jobs']) {
      log('discarding queue for', tab);
      discard.tabs.push(tab);
      return;
    }

    return new Promise(resolve => {
      discard.count += 1;
      discard.time = Date.now();
      const next = () => {
        discard.perform(tab);

        discard.count -= 1;
        if (discard.tabs.length) {
          const tab = discard.tabs.shift();
          inprogress.delete(tab.id);
          discard(tab);
        }
        resolve();
      };
      // favicon
      const icon = () => {
        const src = tab.favIconUrl || '/data/page.png';

        Object.assign(new Image(), {
          crossOrigin: 'anonymous',
          src,
          onerror() {
            next();
          },
          onload() {
            const img = this;
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (ctx) {
              canvas.width = img.width;
              canvas.height = img.height;

              ctx.globalAlpha = 0.6;
              ctx.drawImage(img, 0, 0);

              ctx.globalAlpha = 1;
              ctx.beginPath();
              ctx.fillStyle = '#a1a0a1';
              ctx.arc(img.width * 0.75, img.height * 0.75, img.width * 0.25, 0, 2 * Math.PI, false);
              ctx.fill();
              const href = canvas.toDataURL('image/png');

              chrome.scripting.executeScript({
                target: {
                  tabId: tab.id,
                  allFrames: true
                },
                func: href => {
                  window.stop();
                  if (window === window.top) {
                    [...document.querySelectorAll('link[rel*="icon"]')].forEach(link => link.remove());

                    document.querySelector('head').appendChild(Object.assign(document.createElement('link'), {
                      rel: 'icon',
                      type: 'image/png',
                      href
                    }));
                  }
                },
                args: [href]
              }).catch(() => {}).finally(() => setTimeout(next, prefs['favicon-delay']));
            }
            else {
              next();
            }
          }
        });
      };
      // change title
      if (prefs.prepends) {
        chrome.scripting.executeScript({
          target: {tabId: tab.id},
          func: prepends => {
            window.stop();
            const title = document.title || location.href || '';
            if (title.startsWith(prepends) === false) {
              document.title = prepends + ' ' + title;
            }
          },
          args: [prefs.prepends]
        }).catch(() => {}).finally(() => {
          if (prefs.favicon) {
            icon();
          }
          else {
            setTimeout(next, prefs['favicon-delay']);
          }
        });
      }
      else {
        if (prefs.favicon) {
          icon();
        }
        else {
          next();
        }
      }
    });
  });
};
discard.tabs = [];
discard.count = 0;
discard.perform = tab => {
  try {
    chrome.tabs.discard(tab.id, () => chrome.runtime.lastError);
  }
  catch (e) {
    log('discarding failed', e);
  }
};

export {discard, inprogress};
