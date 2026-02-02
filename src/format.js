import chalk from 'chalk';

/**
 * Pretty-print a search response with citations.
 */
export function formatAnswer(answer, opts = {}) {
  if (!answer) return '';
  // Simple markdown-ish formatting for terminal
  let text = answer;

  // Bold
  text = text.replace(/\*\*(.*?)\*\*/g, chalk.bold('$1'));

  // Citations [1], [2] etc — highlight them
  text = text.replace(/\[(\d+)\]/g, chalk.cyan('[$1]'));

  return text;
}

export function formatSources(webResults, opts = {}) {
  if (!webResults || !Array.isArray(webResults)) return '';
  const lines = webResults.map((r, i) => {
    const num = chalk.cyan(`[${i + 1}]`);
    if (opts.full) {
      const title = r.name || r.title || 'Untitled';
      const url = r.url || '';
      return `  ${num} ${chalk.bold(title)}\n      ${chalk.dim.underline(url)}`;
    }
    return `  ${num} ${chalk.underline(r.url || r.name || 'source')}`;
  });
  return lines.length > 0 ? '\n' + chalk.dim('Sources:') + '\n' + lines.join('\n') : '';
}

export function streamToken(token) {
  process.stdout.write(token);
}
