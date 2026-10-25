import { parseArgs } from 'node:util';

/** Thrown for a wrong command line; the runner prints the usage. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

const help = { help: { type: 'boolean', short: 'h' } };

function usage(tool) {
  const lines = [ `Usage: node tools/ai-tools/src/bin/${tool.name}.mjs <command> [options]`, '', tool.summary, '' ];
  for (const [ name, command ] of Object.entries(tool.commands)) {
    lines.push(`  ${name} ${command.usage}`.trimEnd(), `      ${command.summary}`);
  }
  lines.push('', 'Every command accepts --help.');
  return lines.join('\n');
}

function commandUsage(tool, name, command) {
  const lines = [ `Usage: node tools/ai-tools/src/bin/${tool.name}.mjs ${name} ${command.usage}`.trimEnd(), '' ];
  lines.push(command.summary);
  if (command.help) {
    lines.push('', command.help);
  }
  return lines.join('\n');
}

/**
 * Runs a tool: `tool.commands` maps each command name to `{ usage, summary,
 * help?, options, run(values, positionals) }`, where `options` is a
 * `node:util` `parseArgs` options object. `run` returns the exit code (0 when
 * it returns nothing) and prints its own output.
 */
export async function runCli(tool, argv = process.argv.slice(2)) {
  const [ name, ...rest ] = argv;
  if (!name || name === '--help' || name === '-h') {
    console.log(usage(tool));
    return name ? 0 : 2;
  }
  const command = tool.commands[name];
  if (!command) {
    console.error(`Unknown command: ${name}\n\n${usage(tool)}`);
    return 2;
  }
  try {
    const { values, positionals } = parseArgs({
      args: rest,
      options: { ...help, ...command.options },
      allowPositionals: true,
      strict: true
    });
    if (values.help) {
      console.log(commandUsage(tool, name, command));
      return 0;
    }
    return (await command.run(values, positionals)) ?? 0;
  } catch (error) {
    if (error instanceof UsageError || error.code?.startsWith('ERR_PARSE_ARGS')) {
      console.error(`${error.message}\n\n${commandUsage(tool, name, command)}`);
      return 2;
    }
    console.error(`${error.name}: ${error.message}`);
    return 1;
  }
}

/** Runs `runCli` and exits with its code; the entry point of every tool. */
export function main(tool) {
  runCli(tool).then(code => {
    process.exitCode = code;
  });
}

/** Prints `data` as JSON when `json` is set, or the lines from `text()`. */
export function print(json, data, text) {
  console.log(json ? JSON.stringify(data, null, 2) : text());
}

/** A table of rows (arrays of strings) with padded columns. */
export function table(rows) {
  const widths = rows[0].map((_, i) => Math.max(...rows.map(row => String(row[i]).length)));
  return rows.map(row => row.map((cell, i) => String(cell).padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}
