/** @flow */
import Command from '../../command';
import { commitAction } from '../../../api/consumer';
import Component from '../../../consumer/component';

const chalk = require('chalk');

export default class Export extends Command {
  name = 'commit <id> <message>';
  description = 'commit a component to the local scope and add a log message';
  alias = 'c';
  opts = [
    ['f', 'force', 'forcely commit even if specs fails'],
    ['v', 'verbose', 'show specs output on commit'],
  ];
  loader = true;

  action([id, message]: [string, string], { force, verbose }:
  { force: ?bool, verbose: ?bool }): Promise<any> {
    return commitAction({ id, message, force, verbose });
  }

  report(c: Component): string {
    const componentName = `${c.box}/${c.name}`;
    return chalk.green(`component ${chalk.bold(componentName)} committed successfully`);
  }
}
