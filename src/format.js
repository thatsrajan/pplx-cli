import chalk from 'chalk';

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
