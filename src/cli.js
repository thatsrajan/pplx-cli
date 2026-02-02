import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { extractFromChrome, loadCookies, saveCookies, cookieHeader } from './cookies.js';
import { initSession, testAuth } from './session.js';
import { search } from './search.js';
import { LabsClient } from './labs.js';
import { formatAnswer, formatSources } from './format.js';
import { LABS_MODELS, MODEL_MAP } from './constants.js';
import { setUseCurl } from './http.js';

program
  .name('pplx')
  .description('CLI for Perplexity AI')
  .version('0.1.0');

// Auth command
program
  .command('auth')
  .description('Extract and manage cookies from Chrome')
  .option('--test', 'Test if stored cookies are valid')
  .option('--profile <name>', 'Chrome profile', 'Default')
  .action(async (opts) => {
    if (opts.test) {
      const cookies = loadCookies();
      if (!cookies) {
        console.log(chalk.red('No cookies stored. Run: pplx auth'));
        process.exit(1);
      }
      const spinner = ora('Testing cookies...').start();
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

    const spinner = ora('Extracting cookies from Chrome...').start();
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

      // Init session to refresh cookies
      const { cookies: refreshed } = await initSession(cookies);
      saveCookies(refreshed);
      spinner.succeed(`Extracted ${Object.keys(refreshed).length} cookies and saved to ~/.config/pplx/cookies.json`);

      // Show key info
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

// Search command
program
  .command('search <query>')
  .description('Search with Perplexity (default: pro mode)')
  .option('-m, --mode <mode>', 'Search mode: auto, pro, reasoning, deep-research', 'pro')
  .option('--model <model>', 'Model name or raw ID')
  .option('--sources <sources>', 'Comma-separated: web,scholar,social', 'web')
  .option('--json', 'Output raw JSON')
  .option('--no-citations', 'Hide citation numbers and sources')
  .option('--citations-full', 'Show full citation details (title + URL)')
  .option('--incognito', 'Don\'t save to Perplexity history')
  .option('--lang <code>', 'Language code', 'en-US')
  .option('--curl', 'Force curl-impersonate for TLS')
  .action(async (query, opts) => {
    if (opts.curl) setUseCurl(true);

    const cookies = loadCookies();
    if (!cookies) {
      console.error(chalk.red('No cookies. Run: pplx auth'));
      process.exit(1);
    }

    try {
      let lastAnswer = '';
      let lastData = null;
      const sources = opts.sources.split(',');

      for await (const data of search(query, cookies, {
        mode: opts.mode,
        model: opts.model,
        sources,
        language: opts.lang,
        incognito: opts.incognito,
      })) {
        lastData = data;
        if (opts.json) {
          // In JSON mode, print each event
          console.log(JSON.stringify(data));
          continue;
        }

        // Stream the answer diff
        const answer = data.answer || '';
        if (answer.length > lastAnswer.length) {
          process.stdout.write(answer.slice(lastAnswer.length));
          lastAnswer = answer;
        }
      }

      if (!opts.json) {
        process.stdout.write('\n');
        // Show sources if available (default: on, --no-citations hides them)
        if (opts.citations !== false && lastData?.web_results) {
          console.log(formatSources(lastData.web_results, { full: opts.citationsFull }));
        }
      }
    } catch (e) {
      console.error(chalk.red('\nError:'), e.message);
      if (e.message.includes('403')) {
        console.log(chalk.yellow('Possible TLS fingerprinting block. Try: pplx search --curl "query"'));
      }
      process.exit(1);
    }
  });

// Shorthand: reason
program
  .command('reason <query>')
  .description('Reasoning mode search')
  .option('--model <model>', 'Model name')
  .option('--json', 'Output raw JSON')
  .option('--curl', 'Force curl-impersonate')
  .action(async (query, opts) => {
    // Delegate to search with reasoning mode
    await program.commands.find(c => c.name() === 'search')
      .parseAsync(['node', 'pplx', 'search', query, '--mode', 'reasoning',
        ...(opts.model ? ['--model', opts.model] : []),
        ...(opts.json ? ['--json'] : []),
        ...(opts.curl ? ['--curl'] : []),
      ]);
  });

// Shorthand: research
program
  .command('research <query>')
  .description('Deep research mode')
  .option('--json', 'Output raw JSON')
  .option('--curl', 'Force curl-impersonate')
  .action(async (query, opts) => {
    if (opts.curl) setUseCurl(true);
    const cookies = loadCookies();
    if (!cookies) {
      console.error(chalk.red('No cookies. Run: pplx auth'));
      process.exit(1);
    }

    const spinner = ora('Deep research in progress...').start();
    try {
      let lastAnswer = '';
      let lastData = null;
      for await (const data of search(query, cookies, { mode: 'deep-research' })) {
        lastData = data;
        if (opts.json) {
          spinner.stop();
          console.log(JSON.stringify(data));
          continue;
        }
        const answer = data.answer || '';
        if (answer.length > lastAnswer.length) {
          spinner.stop();
          process.stdout.write(answer.slice(lastAnswer.length));
          lastAnswer = answer;
        }
      }
      if (!opts.json && lastAnswer) process.stdout.write('\n');
    } catch (e) {
      spinner.fail(e.message);
      process.exit(1);
    }
  });

// Labs command
program
  .command('labs <query>')
  .description('Query open-source models (no auth needed)')
  .option('--model <model>', `Model: ${LABS_MODELS.join(', ')}`, 'sonar')
  .option('--json', 'Output raw JSON')
  .action(async (query, opts) => {
    const spinner = ora('Connecting to labs...').start();
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

// Default: treat bare args as search
program
  .argument('[query...]', 'Quick search (shorthand for pplx search)')
  .action(async (query) => {
    if (query.length > 0) {
      const q = query.join(' ');
      // Re-invoke search
      process.argv = ['node', 'pplx', 'search', q];
      await program.parseAsync(process.argv);
    }
  });

program.parseAsync();
