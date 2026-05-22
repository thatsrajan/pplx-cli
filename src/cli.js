import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { extractFromChrome, loadCookies, saveCookies, SUPPORTED_BROWSERS } from './cookies.js';
import { extractFromPlaywright } from './playwright-auth.js';
import { initSession, testAuth } from './session.js';
import { search } from './search.js';
import { LabsClient } from './labs.js';
import { formatSources } from './format.js';
import { LABS_MODELS, MODEL_MAP } from './constants.js';
import { setUseCurl } from './http.js';
import { loadConfig } from './config.js';
import { resolveTimeoutMs } from './timeout.js';
import { makeArtifactContext, resolveArtifactDir, writeStandardArtifact } from './artifacts.js';
import {
  createComputerRun,
  copyTextToClipboard,
  importComputerResult,
  inspectComputerRun,
  openComputerUrl,
  readTaskFile,
} from './computer.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

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

function finishSuccess(spinner, message) {
  if (isQuiet()) {
    spinner.stop();
    console.log(chalk.green(`✓ ${message}`));
    return;
  }
  spinner.succeed(message);
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

async function extractAndValidateBrowser(browser, profile) {
  const cookies = extractFromChrome(profile, browser);
  const count = Object.keys(cookies).length;
  const hasSession = Boolean(cookies['next-auth.session-token'] || cookies['__Secure-next-auth.session-token']);
  if (!hasSession) {
    return { browser, profile, cookies, count, hasSession, ok: false };
  }

  const session = await initSession(cookies);
  return {
    browser,
    profile,
    cookies: session.cookies,
    count: Object.keys(session.cookies).length,
    hasSession,
    ok: session.ok,
    status: session.status,
  };
}

// --- Program setup ---
program
  .name('pplx')
  .description('CLI for Perplexity AI')
  .version(pkg.version);

program.option('--verbose', 'Enable verbose logging');
program.option('--proxy <url>', 'Set proxy URL (sets HTTPS_PROXY env var)');
program.option('--raw', 'Plain text output, no colors, no spinner');
program.option('--out <dir>', 'Directory for saved artifacts');
program.option('--no-artifact', 'Disable artifact saving for this run');
program.option('--artifact-id <id>', 'Deterministic artifact id for this run');

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

function getOpts(commandOrOpts) {
  const globals = program.opts();
  const locals = commandOrOpts.optsWithGlobals
    ? { ...commandOrOpts.optsWithGlobals(), ...commandOrOpts.opts() }
    : commandOrOpts;
  const merged = { ...globals, ...locals };
  if (globals.artifact === false || locals.artifact === false) merged.artifact = false;
  return merged;
}

function addArtifactOptions(command, { allowDisable = true } = {}) {
  command
    .option('--out <dir>', 'Directory for saved artifacts')
    .option('--artifact-id <id>', 'Deterministic artifact id for this run');
  if (allowDisable) command.option('--no-artifact', 'Disable artifact saving for this run');
  return command;
}

function maybePrintArtifactInfo(info, opts) {
  if (!info || opts.json || rawMode) return;
  console.log(chalk.dim(`\nArtifact: ${info.artifactDir}`));
}

function resolveRunDir(runId, opts = {}) {
  if (isAbsolute(runId) || runId.includes('/')) return resolve(runId);
  const cfg = loadConfig();
  return join(resolveArtifactDir({ out: opts.out, config: cfg }), runId);
}

// Auth command
program
  .command('auth')
  .description('Extract and manage cookies from supported browsers')
  .option('--test', 'Test if stored cookies are valid')
  .option('--profile <name>', 'Chrome profile', 'Default')
  .option('--browser <name>', `Browser store: auto, ${SUPPORTED_BROWSERS.join(', ')}`, 'auto')
  .option('--playwright', 'Use Playwright to login and extract cookies')
  .option('--headless', 'Run Playwright in headless mode (not recommended for login)')
  .action(async (opts) => {
    const cfg = loadConfig();
    const usePlaywright = opts.playwright === true;
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
        if (!ok) {
          console.log(chalk.dim('  Run: pplx auth --browser auto'));
        }
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

        const { cookies: refreshed, ok } = await initSession(cookies);
        if (!ok) {
          console.log(chalk.red('✗ Login cookies were extracted but are not authenticated.'));
          console.log(chalk.dim('  Try again after logging into Perplexity in the Playwright browser.'));
          process.exit(1);
        }
        saveCookies(refreshed);
        console.log(chalk.green(`✓ Extracted ${Object.keys(refreshed).length} cookies and saved to ~/.config/pplx/cookies.json`));
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
      const attempts = [];
      let result = null;

      if (opts.browser === 'auto') {
        for (const browser of SUPPORTED_BROWSERS) {
          try {
            const attempt = await extractAndValidateBrowser(browser, opts.profile);
            attempts.push(attempt);
            if (attempt.ok) {
              result = attempt;
              break;
            }
          } catch (e) {
            attempts.push({
              browser,
              profile: opts.profile,
              count: 0,
              hasSession: false,
              ok: false,
              error: e.message,
            });
          }
        }
      } else {
        result = await extractAndValidateBrowser(opts.browser, opts.profile);
        attempts.push(result);
      }

      if (!result) {
        result = { browser: opts.browser, profile: opts.profile, cookies: {}, count: 0, hasSession: false, ok: false };
      }

      const cookies = result.cookies;
      const count = Object.keys(cookies).length;
      spinner.text = `Found ${count} cookies. Testing auth...`;

      const hasSession = cookies['next-auth.session-token'] || cookies['__Secure-next-auth.session-token'];
      if (!hasSession) {
        spinner.stop();
        console.log(chalk.yellow(`⚠ Found ${count} cookies but no session token.`));
        console.log('  Make sure you are logged into perplexity.ai in a supported browser.');
        if (attempts.length) {
          for (const attempt of attempts) {
            const suffix = attempt.error ? ` (${attempt.error.split('\n')[0]})` : '';
            console.log(chalk.dim(`  - ${attempt.browser}: ${attempt.count} cookies${suffix}`));
          }
        }
        console.log(chalk.dim('  Existing cookie file was left unchanged.'));
        return;
      }

      if (!result.ok) {
        spinner.stop();
        console.log(chalk.red(`✗ Found ${count} cookies in ${result.browser}, but they are invalid or expired.`));
        if (attempts.length) {
          for (const attempt of attempts) {
            const status = attempt.ok ? 'valid' : (attempt.hasSession ? 'expired' : 'no session');
            const suffix = attempt.error ? ` (${attempt.error.split('\n')[0]})` : '';
            console.log(chalk.dim(`  - ${attempt.browser}: ${attempt.count} cookies, ${status}${suffix}`));
          }
        }
        console.log(chalk.dim('  Existing cookie file was left unchanged.'));
        process.exit(1);
      }

      saveCookies(cookies);
      finishSuccess(spinner, `Extracted ${Object.keys(cookies).length} cookies from ${result.browser} and saved to ~/.config/pplx/cookies.json`);
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
async function doSearch(query, opts, commandName = 'search') {
  const cfg = loadConfig();
  opts = { ...cfg, ...getOpts(opts) };
  if (opts.curl) setUseCurl(true);

  const cookies = loadCookies() || {};
  if (!opts.chrome && Object.keys(cookies).length === 0) {
    console.error(chalk.red('No cookies. Run: pplx auth'));
    process.exit(1);
  }
  if (!opts.chrome && !opts.allowAnonymous) {
    const ok = await testAuth(cookies);
    if (!ok) {
      console.error(chalk.red('Stored cookies are invalid or expired. Run: pplx auth --browser auto'));
      process.exit(1);
    }
  }

  const mode = opts.mode || 'pro';
  let timeoutMs;
  try {
    timeoutMs = resolveTimeoutMs({ ...opts, mode });
  } catch (e) {
    console.error(chalk.red(e.message));
    process.exit(1);
  }
  const sources = opts.sources ? opts.sources.split(',') : ['web'];
  const lang = opts.lang || 'en-US';
  let artifactCtx = null;
  try {
    artifactCtx = makeArtifactContext({ command: commandName, query, opts, config: cfg });
  } catch (e) {
    console.error(chalk.red(e.message));
    process.exit(1);
  }

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
      timeoutMs,
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
      const normalizedSources = webResults.map(r => ({ title: r.name || r.title, url: r.url }));
      const artifactInfo = writeStandardArtifact(artifactCtx, {
        answer,
        sources: normalizedSources,
        mode,
        model: opts.model || 'default',
      });
      const jsonOut = {
        answer,
        sources: normalizedSources,
        query,
        mode,
        model: opts.model || 'default',
        artifactDir: artifactInfo?.artifactDir,
        artifactId: artifactInfo?.artifactId,
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
    const webResults = lastData?.web_results || [];
    const artifactInfo = writeStandardArtifact(artifactCtx, {
      answer: lastAnswer,
      sources: webResults.map(r => ({ title: r.name || r.title, url: r.url })),
      mode,
      model: opts.model || 'default',
    });
    maybePrintArtifactInfo(artifactInfo, opts);
  } catch (e) {
    console.error(chalk.red('\nError:'), e.message);
    if (e.message.includes('403')) {
      console.log(chalk.yellow('Possible TLS fingerprinting block. Try: pplx search --curl "query" or --playwright'));
    }
    process.exit(1);
  }
}

// Search command
addArtifactOptions(program
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
  .option('--no-playwright', 'Disable Playwright even if config enables it')
  .option('--timeout-ms <duration>', 'Overall stream timeout: milliseconds by default, or use 120s / 10m')
  .option('--allow-anonymous', 'Allow anonymous Perplexity responses when cookies are expired'))
  .action(async (queryArg, opts) => {
    opts = getOpts(opts);
    if (opts.raw) { rawMode = true; chalk.level = 0; }
    const query = await resolveQuery(queryArg);
    await doSearch(query, opts, 'search');
  });

// Shorthand: reason
addArtifactOptions(program
  .command('reason [query]')
  .description('Reasoning mode search')
  .option('--model <model>', 'Model name')
  .option('--json', 'Output raw JSON')
  .option('--curl', 'Force curl-impersonate')
  .option('--chrome', 'Use Chrome CDP bridge')
  .option('--playwright', 'Use Playwright headless Chromium')
  .option('--no-playwright', 'Disable Playwright even if config enables it')
  .option('--timeout-ms <duration>', 'Overall stream timeout: milliseconds by default, or use 120s / 10m')
  .option('--allow-anonymous', 'Allow anonymous Perplexity responses when cookies are expired'))
  .action(async (queryArg, opts) => {
    opts = getOpts(opts);
    const query = await resolveQuery(queryArg);
    await doSearch(query, { ...opts, mode: 'reasoning' }, 'reason');
  });

// Shorthand: research
addArtifactOptions(program
  .command('research [query]')
  .description('Deep research mode')
  .option('--json', 'Output raw JSON')
  .option('--curl', 'Force curl-impersonate')
  .option('--chrome', 'Use Chrome CDP bridge')
  .option('--playwright', 'Use Playwright headless Chromium')
  .option('--no-playwright', 'Disable Playwright even if config enables it')
  .option('--timeout-ms <duration>', 'Overall stream timeout: milliseconds by default, or use 120s / 10m')
  .option('--allow-anonymous', 'Allow anonymous Perplexity responses when cookies are expired'))
  .action(async (queryArg, opts) => {
    opts = getOpts(opts);
    const query = await resolveQuery(queryArg);
    const spinner = makeSpinner('Deep research in progress...').start();
    try {
      await doSearch(query, { ...opts, mode: 'deep-research', _spinner: spinner }, 'research');
    } catch (e) {
      spinner.fail(e.message);
      process.exit(1);
    }
  });

// Labs command
addArtifactOptions(program
  .command('labs [query]')
  .description('Query open-source models (no auth needed)')
  .option('--model <model>', `Model: ${LABS_MODELS.join(', ')}`, 'sonar')
  .option('--json', 'Output single JSON object with answer, events, and artifact metadata'))
  .action(async (queryArg, opts) => {
    opts = getOpts(opts);
    const cfg = loadConfig();
    const query = await resolveQuery(queryArg);
    let artifactCtx = null;
    try {
      artifactCtx = makeArtifactContext({ command: 'labs', query, opts, config: cfg });
    } catch (e) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }
    const spinner = makeSpinner('Connecting to labs...').start();
    const client = new LabsClient();
    try {
      await client.connect();
      spinner.stop();

      let lastOutput = '';
      const events = [];
      for await (const data of client.ask(query, opts.model)) {
        events.push(data);
        if (opts.json) {
          continue;
        }
        const output = data.output || '';
        if (output.length > lastOutput.length) {
          process.stdout.write(output.slice(lastOutput.length));
          lastOutput = output;
        }
      }
      if (!opts.json) process.stdout.write('\n');
      const artifactInfo = writeStandardArtifact(artifactCtx, {
        answer: lastOutput,
        sources: [],
        mode: 'labs',
        model: opts.model,
      });
      if (opts.json) {
        console.log(JSON.stringify({
          answer: lastOutput,
          events,
          query,
          mode: 'labs',
          model: opts.model,
          artifactDir: artifactInfo?.artifactDir,
          artifactId: artifactInfo?.artifactId,
        }));
      } else {
        maybePrintArtifactInfo(artifactInfo, opts);
      }
    } catch (e) {
      spinner.fail('Labs error: ' + e.message);
      if (isQuiet()) console.error(chalk.red('Labs error:'), e.message);
      process.exit(1);
    } finally {
      client.close();
    }
  });

// Computer artifact handoff workflow
const computer = program
  .command('computer')
  .description('Create and manage Perplexity Computer artifact handoffs');

addArtifactOptions(computer
  .command('new [task]')
  .description('Create a Perplexity Computer task artifact')
  .option('--template <name>', 'Computer task template', 'compare')
  .option('--json', 'Output run metadata as JSON'), { allowDisable: false })
  .action(async (taskArg, opts) => {
    opts = getOpts(opts);
    const task = await resolveQuery(taskArg);
    try {
      const run = createComputerRun({
        task,
        template: opts.template,
        opts,
        config: loadConfig(),
      });
      if (opts.json) {
        console.log(JSON.stringify(run));
        return;
      }
      console.log(chalk.green(`✓ Computer task artifact created: ${run.artifactDir}`));
      console.log(chalk.dim(`  Task: ${run.taskPath}`));
      console.log(chalk.dim(`  Result: ${run.resultPath}`));
    } catch (e) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }
  });

addArtifactOptions(computer
  .command('open <run>')
  .description('Open Perplexity Computer and optionally copy task.md')
  .option('--copy', 'Copy task.md to the clipboard'), { allowDisable: false })
  .action((runId, opts) => {
    opts = getOpts(opts);
    const runDir = resolveRunDir(runId, opts);
    try {
      if (opts.copy) {
        const taskText = readTaskFile(runDir);
        if (!copyTextToClipboard(taskText)) {
          console.log(chalk.yellow('Clipboard copy is only supported on macOS.'));
        }
      }
      if (!openComputerUrl()) {
        console.log(chalk.yellow('Opening Perplexity Computer is only supported on macOS.'));
        console.log('https://www.perplexity.ai/computer');
        return;
      }
      console.log(chalk.green(`✓ Opened Perplexity Computer for ${runDir}`));
      if (opts.copy) console.log(chalk.dim('  Copied task.md to clipboard.'));
    } catch (e) {
      console.error(chalk.red(e.message));
      process.exit(1);
    }
  });

addArtifactOptions(computer
  .command('status <run>')
  .description('Inspect a Perplexity Computer artifact run')
  .option('--json', 'Output status as JSON'), { allowDisable: false })
  .action((runId, opts) => {
    opts = getOpts(opts);
    const status = inspectComputerRun(resolveRunDir(runId, opts));
    if (opts.json) {
      console.log(JSON.stringify(status));
      return;
    }
    const label = status.status === 'complete'
      ? chalk.green('[✓] Complete')
      : status.status === 'pending'
        ? chalk.yellow('[○] Pending')
        : chalk.red(status.status === 'invalid' ? '[!] Invalid' : '[✗] Missing');
    console.log(`${label} ${status.artifactDir}`);
    if (status.reason) console.log(chalk.dim(`  ${status.reason}`));
  });

addArtifactOptions(computer
  .command('import <run>')
  .description('Print a completed Perplexity Computer result')
  .option('--json', 'Output compact JSON'), { allowDisable: false })
  .action((runId, opts) => {
    opts = getOpts(opts);
    try {
      const result = importComputerResult(resolveRunDir(runId, opts));
      console.log(opts.json ? JSON.stringify(result) : JSON.stringify(result, null, 2));
    } catch (e) {
      console.error(chalk.red(e.message));
      process.exit(1);
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
  .action(async (query, opts) => {
    if (query.length > 0) {
      await doSearch(query.join(' '), getOpts(opts || program), 'search');
    }
  });

program.parseAsync().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
