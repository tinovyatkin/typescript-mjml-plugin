// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

interface FormatConfig {
  readonly enabled: boolean;
}

interface TsHtmlPluginConfiguration {
  readonly tags: ReadonlyArray<string>;
  readonly format: FormatConfig;
}

const defaultConfiguration: TsHtmlPluginConfiguration = {
  tags: ["mjml", "mjml-fragment"],
  format: {
    enabled: true
  }
};

export class Configuration {
  private _format = defaultConfiguration.format;
  private _tags = defaultConfiguration.tags;

  public update(config?: Partial<TsHtmlPluginConfiguration>) {
    this._format = { ...defaultConfiguration.format, ...config?.format };
    this._tags = config?.tags ?? defaultConfiguration.tags;
  }

  public get format(): FormatConfig {
    return this._format;
  }
  public get tags(): ReadonlyArray<string> {
    return this._tags;
  }
}
