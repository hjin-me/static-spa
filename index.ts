import puppeteer, { LaunchOptions } from 'puppeteer';
import { parse as urlParse } from 'url';
const fs = require('fs-extra');
import { posix, join as pathJoin } from 'path';
const { join: urlJoin, extname } = posix;
import { OptionDefinition } from 'command-line-args';
import commandLineArgs from 'command-line-args';

const optionDefinitions: OptionDefinition[] = [
  { name: 'root', alias: 'd', type: String, defaultValue: '/var/www' },
  { name: 'url', alias: 'u', type: String },
  { name: 'chromium', alias: 'c', type: String }
];
const options = commandLineArgs(optionDefinitions);

const RENDER_CACHE = new Map();
function writeIndex(url: string, html: string) {
  let path = urlParse(url).pathname;
  if (!path) {
    console.error('path illegal', url);
    return;
  }
  if (!extname(path)) {
    path = urlJoin(path, '/index.html');
  }
  console.log('write data ', pathJoin(options.root, path));
  fs.outputFileSync(pathJoin(options.root, path), html);
}

async function ssr(
  url: string
): Promise<{ html: string; links: string[]; ttRenderMs: number; url: string }> {
  if (RENDER_CACHE.has(url)) {
    return { html: RENDER_CACHE.get(url), ttRenderMs: 0, url, links: [] };
  }

  const start = Date.now();

  const opts: LaunchOptions = {};
  if (options.chromium) {
    opts.executablePath = options.chromium;
  }
  const browser = await puppeteer.launch(opts);
  const page = await browser.newPage();
  let links: string[] = [];
  try {
    // networkidle0 waits for the network to be idle (no requests for 500ms).
    // The page's JS has likely produced markup by this point, but wait longer
    // if your site lazy loads, etc.
    await page.goto(url, { waitUntil: 'networkidle0' });
    // await page.waitForSelector("#posts"); // ensure #posts exists in the DOM.
    links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[routerlink], a[href]'))
        .map(ele =>
          ele.hasAttribute('routerlink')
            ? ele.getAttribute('routerlink') || ''
            : ele.getAttribute('href') || ''
        )
        .map(path => {
          const a = document.createElement('a');
          // 自动补全域名前缀
          a.href = path;
          if (a.href.indexOf('//' + location.hostname) === -1) {
            return '';
          }
          return a.href;
        })
        .filter(h => !!h)
    );
  } catch (err) {
    console.error(err);
    throw new Error('page.goto/waitForSelector timed out.');
  }

  const html = await page.content(); // serialized HTML of page DOM.
  await browser.close();

  const ttRenderMs = Date.now() - start;
  console.info(`Headless rendered page in: ${ttRenderMs}ms`);

  RENDER_CACHE.set(url, html); // cache rendered page.
  return { url, html, links, ttRenderMs };
}

const visited = new Set<string>();
const linkList: string[] = [];
linkList.push(options.url);

function* asyncLinkList() {
  while (linkList.length > 0) {
    let link = linkList.shift();
    if (!link) {
      continue;
    }
    if (visited.has(link)) {
      continue;
    }
    console.log('shift url', link);
    yield link;
  }
}

(async () => {
  for (let url of asyncLinkList()) {
    const { html, links } = await ssr(url);
    writeIndex(url, html);
    console.log('complete', url);
    visited.add(url);
    linkList.push(...links);
  }
})().finally(() => {
  console.log('all complete');
});
