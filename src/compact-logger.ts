import { Logger } from '@nestjs/common';

export class CompactLogger extends Logger {
  protected prefix = '';

  start(prefix: string) {
    this.prefix += ' ' + prefix;
    return this;
  }

  end() {
    this.prefix = this.prefix.split(' ').slice(0, -1).join(' ');
    return this;
  }

  log(message: any) {
    super.log(message, this.prefix);
    return this;
  }

  logList(list: any, mapper) {
    for (const item of list) {
      super.log(mapper(item), this.prefix);
    }
    return this;
  }
}
