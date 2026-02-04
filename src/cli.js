import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { extractFromChrome, loadCookies, saveCookies, cookieHeader } from './cookies.js';
import { extractFromPlaywright } from './playwright-auth.js';
import { initSession, testAuth } from './session.js';
import { search } from './search.js';
import { LabsClient } from './labs.js';
import { formatSources } from './format.js';
import { LABS_MODELS, MODEL_MAP } from './constants.js';
import { setUseCurl } from './http.js';
import { loadConfig } from './config.js';

// --- Output state ---
let rawMode = false;

function isQuiet() {
  return rawMode || !process.stdout.isTTY;
}

function makeSpinner(text) {
  if (isQuiet()) {
    // noop spinner
    return { start() { return this; }, stop() {}, succeed() {}, fail() {}, text: '' };
  }
  return ora(text);
}

// --- Stdin helper ---
function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data.trim()));
    process.stdin.on('error', reject);
  });
}

async function resolveQuery(queryArg) {
  if (queryArg && queryArg !== '-') return queryArg;
  if (queryArg === '-' || !process.stdin.isTTY) {
    const input = await readStdin();
    if (!input) {
      console.error('Error: no query provided via stdin');
      process.exit(1);
    }
    return input;
  }
  console.error('Error: no query provided');
  process.exit(1);
}

// --- Program setup ---
program
  .name('pplx')
  .description('CLI for Perplexity AI')
  .version('0.1.1');

program.option('--verbose', 'Enable verbose logging');
program.option('--proxy <url>', 'Set proxy URL (sets HTTPS_PROXY env var)');
program.option('--raw', 'Plain text output, no colors, no spinner');

program.hook('preAction', (thisCmd) => {
  const gopts = thisCmd.optsWithGlobals ? thisCmd.optsWithGlobals() : thisCmd.opts();
  if (gopts.verbose) process.env.PPLX_VERBOSE = '1';
  if (gopts.proxy) process.env.HTTPS_PROXY = gopts.proxy;
  if (gopts.raw) {
    rawMode = true;
    chalk.level = 0;
  }
  if (!process.stdout.isTTY) {
    chalk.level = 0;
  }
});

// Auth command
program
  .command('auth')
  .description('Extract and manage cookies from Chrome')
  .option('--test', 'Test if stored cookies are valid')
  .option('--profile <name>', 'Chrome profile', 'Default')
  .option('--playwright', 'Use Playwright to login and extract cookies')
  .option('--headless', 'Run Playwright in headless mode (not recommended for login)')
  .action(async (opts) => {
    const cfg = loadConfig();
    const usePlaywright = opts.playwright ?? cfg.playwright;
    const playwrightHeadless = opts.headless ?? cfg.playwrightHeadless ?? false;

    if (opts.test) {
      const cookies = loadCookies();
      if (!cookies) {
        console.log(chalk.red('No cookies stored. Run: pplx auth'));
        process.exit(1);
      }
      const spinner = makeSpinner('Testing cookies...').start();
      try {
        const ok = await testAuth(cookies);
        spinner.stop();
        console.log(ok ? chalk.green('✓ Cookies are valid') : chalk.red('✗ Cookies are invalid or expired'));
        process.exit(ok ? 0 : 1);
      } catch (e) {
        spinner.stop();
        console.error(chalk.red('Error:'), e.message);
        process.exit(1);
      }
      return;
    }

    if (usePlaywright) {
      const spinner = makeSpinner('Launching Playwright for login...').start();
      try {
        spinner.stop();
        const cookies = await extractFromPlaywright({ headless: playwrightHeadless });
        const count = Object.keys(cookies).length;
        const hasSession = cookies['next-auth.session-token'] || cookies['__Secure-next-auth.session-token'];

        if (!hasSession) {
          console.log(chalk.yellow(`⚠ Found ${count} cookies but no session token.`));
          console.log('  Make sure you are logged into perplexity.ai in Playwright.');
          if (count > 0) {
            saveCookies(cookies);
            console.log(chalk.dim('  Saved cookies anyway.'));
          }
          return;
        }

        const { cookies: refreshed } = await initSession(cookies);
        saveCookies(refreshed);
        console.log(chalk.green(`✓ Extracted ${Object.keys(refreshed).length} cookies and saved to ~/.config/pplx/cookies.json`));
        const token = refreshed['__Secure-next-auth.session-token'] || refreshed['next-auth.session-token'];
        console.log(chalk.dim(`  Session token: ${token?.slice(0, 20)}...`));
        return;
      } catch (e) {
        spinner.stop();
        console.error(chalk.red('Failed to extract cookies via Playwright'));
        console.error(chalk.red(e.message));
        process.exit(1);
      }
    }

    const spinner = makeSpinner('Extracting cookies from Chrome...').start();
    try {
      const cookies = extractFromChrome(opts.profile);
      const count = Object.keys(cookies).length;
      spinner.text = `Found ${count} cookies. Testing auth...`;

      const hasSession = cookies['next-auth.session-token'] || cookies['__Secure-next-auth.session-token'];
      if (!hasSession) {
        spinner.stop();
        console.log(chalk.yellow(`⚠ Found ${count} cookies but no session token.`));
        console.log('  Make sure you are logged into perplexity.ai in Chrome.');
        if (count > 0) {
          saveCookies(cookies);
          console.log(chalk.dim('  Saved cookies anyway.'));
        }
        return;
      }

      const { cookies: refreshed } = await initSession(cookies);
      saveCookies(refreshed);
      spinner.succeed(`Extracted ${Object.keys(refreshed).length} cookies and saved to ~/.config/pplx/cookies.json`);

      const token = refreshed['__Secure-next-auth.session-token'] || refreshed['next-auth.session-token'];
      console.log(chalk.dim(`  Session token: ${token?.slice(0, 20)}...`));
    } catch (e) {
      spinner.fail('Failed to extract cookies');
      console.error(chalk.red(e.message));
      if (e.message.includes('Keychain')) {
        console.log(chalk.dim('  You may need to allow access in the Keychain prompt.'));
      }
      process.exit(1);
    }
  });

// Shared search logic
async function doSearch(query, opts) {
  const cfg = loadConfig();
  opts = { ...cfg, ...opts };
  if (opts.curl) setUseCurl(true);

  const cookies = loadCookies();
  if (!cookies) {
    console.error(chalk.red('No cookies. Run: pplx auth'));
    process.exit(1);
  }

  const mode = opts.mode || 'pro';
  const sources = opts.sources ? opts.sources.split(',') : ['web'];
  const lang = opts.lang || 'en-US';

  try {
    let lastAnswer = '';
    let lastData = null;
    let spinnerStopped = false;

    for await (const data of search(query, cookies, {
      mode,
      model: opts.model,
      sources,
      language: lang,
      incognito: opts.incognito,
      chrome: opts.chrome,
      playwright: opts.playwright,
      curl: opts.curl,
    })) {
      lastData = data;

      if (opts.json) {
        // For --json, we accumulate and output a single final object at the end
        if (opts._spinner && !spinnerStopped) { opts._spinner.stop(); spinnerStopped = true; }
        continue;
      }

      // Stream the answer diff
      const answer = data.answer || '';
      if (answer.length > lastAnswer.length) {
        if (opts._spinner && !spinnerStopped) { opts._spinner.stop(); spinnerStopped = true; }
        process.stdout.write(answer.slice(lastAnswer.length));
        lastAnswer = answer;
      }
    }

    if (opts.json) {
      // Output single final JSON object
      const answer = lastData?.answer || lastAnswer || '';
      const webResults = lastData?.web_results || [];
      const jsonOut = {
        answer,
        sources: webResults.map(r => ({ title: r.name || r.title, url: r.url })),
        query,
        mode,
        model: opts.model || 'default',
      };
      console.log(JSON.stringify(jsonOut));
      if (!answer) process.exit(1);
      return;
    }

    if (!lastAnswer) {
      if (opts._spinner && !spinnerStopped) { opts._spinner.stop(); spinnerStopped = true; }
      console.error(chalk.yellow('No answer received. Try re-authing (pplx auth) or use --playwright/--curl.'));
      process.exit(1);
    }

    process.stdout.write('\n');
    if (!rawMode && opts.citations !== false && lastData?.web_results) {
      console.log(formatSources(lastData.web_results, { full: opts.citationsFull }));
    }
  } catch (e) {
    console.error(chalk.red('\nError:'), e.message);
    if (e.message.includes('403')) {
      console.log(chalk.yellow('Possible TLS fingerprinting block. Try: pplx search --curl "query" or --playwright'));
    }
    process.exit(1);
  }
}

// Search command
program
  .command('search [query]')
  .description('Search with Perplexity (default: pro mode)')
  .option('-m, --mode <mode>', 'Search mode: auto, pro, reasoning, deep-research', 'pro')
  .option('--model <model>', 'Model name or raw model ID (see pplx models)')
  .option('--sources <sources>', 'Comma-separated: web,scholar,social', 'web')
  .option('--json', 'Output single JSON object with answer, sources, query, mode, model')
  .option('--raw', 'Plain text answer only (alias for global --raw)')
  .option('--no-citations', 'Hide citation numbers and sources')
  .option('--citations-full', 'Show full citation details (title + URL)')
  .option('--incognito', 'Don\'t save to Perplexity history')
  .option('--lang <code>', 'Language code', 'en-US')
  .option('--curl', 'Force curl-impersonate for TLS')
  .option('--chrome', 'Use Chrome CDP bridge instead of HTTP')
  .option('--playwright', 'Use Playwright headless Chromium instead of HTTP')
  .action(async (queryArg, opts) => {
    if (opts.raw) { rawMode = true; chalk.level = 0; }
    const query = await resolveQuery(queryArg);
    await doSearch(query, opts);
  });

// Shorthand: reason
program
  .command('reason [query]')
  .description('Reasoning mode search')
  .option('--model <model>', 'Model name')
  .option('--json', 'Output raw JSON')
  .option('--curl', 'Force curl-impersonate')
  .option('--chrome', 'Use Chrome CDP bridge')
  .option('--playwright', 'Use Playwright headless Chromium')
  .action(async (queryArg, opts) => {
    const query = await resolveQuery(queryArg);
    await doSearch(query, { ...opts, mode: 'reasoning' });
  });

// Shorthand: research
program
  .command('research [query]')
  .description('Deep research mode')
  .option('--json', 'Output raw JSON')
  .option('--curl', 'Force curl-impersonate')
  .option('--chrome', 'Use Chrome CDP bridge')
  .option('--playwright', 'Use Playwright headless Chromium')
  .action(async (queryArg, opts) => {
    const query = await resolveQuery(queryArg);
    const spinner = makeSpinner('Deep research in progress...').start();
    try {
      await doSearch(query, { ...opts, mode: 'deep-research', _spinner: spinner });
    } catch (e) {
      spinner.fail(e.message);
      process.exit(1);
    }
  });

// Labs command
program
  .command('labs [query]')
  .description('Query open-source models (no auth needed)')
  .option('--model <model>', `Model: ${LABS_MODELS.join(', ')}`, 'sonar')
  .option('--json', 'Output raw JSON')
  .action(async (queryArg, opts) => {
    const query = await resolveQuery(queryArg);
    const spinner = makeSpinner('Connecting to labs...').start();
    const client = new LabsClient();
    try {
      await client.connect();
      spinner.stop();

      let lastOutput = '';
      for await (const data of client.ask(query, opts.model)) {
        if (opts.json) {
          console.log(JSON.stringify(data));
          continue;
        }
        const output = data.output || '';
        if (output.length > lastOutput.length) {
          process.stdout.write(output.slice(lastOutput.length));
          lastOutput = output;
        }
      }
      if (!opts.json) process.stdout.write('\n');
    } catch (e) {
      spinner.fail('Labs error: ' + e.message);
      process.exit(1);
    } finally {
      client.close();
    }
  });

// Models command
program
  .command('models')
  .description('List available models')
  .action(() => {
    for (const [mode, models] of Object.entries(MODEL_MAP)) {
      console.log(chalk.bold(`\n${mode.charAt(0).toUpperCase() + mode.slice(1)} models:`));
      for (const [name, id] of Object.entries(models)) {
        console.log(`  ${name.padEnd(30)} ${chalk.dim(id)}`);
      }
    }
    console.log(chalk.bold('\nLabs models:'), LABS_MODELS.join(', '));
  });

// Default: treat bare args as search
program
  .argument('[query...]', 'Quick search (shorthand for pplx search)')
  .action(async (query) => {
    if (query.length > 0) {
      await doSearch(query.join(' '), {});
    }
  });

program.parseAsync().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
