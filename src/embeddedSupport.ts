/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// Original code forked from https://github.com/vscode-langservers/vscode-html-languageserver/

import {
  TextDocument,
  Position,
  LanguageService,
  TokenType,
  Range
} from "vscode-html-languageservice";

export interface LanguageRange extends Range {
  languageId: string | undefined;
  attributeValue?: boolean;
}

export interface HTMLDocumentRegions {
  getEmbeddedDocument(
    languageId: string,
    ignoreAttributeValues?: boolean
  ): TextDocument;
  getLanguageRanges(range: Range): LanguageRange[];
  getLanguagesInDocument(): string[];
  getLanguageAtPosition(position: Position): string | undefined;
  getImportedScripts(): string[];
}

export const CSS_STYLE_RULE = "__";
export const MJML_CSS_ATTRIBUTES = new Set([
  "align",
  "color",
  "container-background-color",
  "border",
  "border-top",
  "border-left",
  "border-right",
  "border-bottom",
  "border-radius",
  "tb-border",
  "tb-border-radius",
  "tb-hover-border-color",
  "tb-selected-border-color",
  "tb-width",
  "background-color",
  "icon-width",
  "icon-height",
  "icon-position",
  "padding",
  "padding-top",
  "padding-left",
  "padding-right",
  "padding-bottom",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "height",
  "inner-padding",
  "line-height",
  "text-align",
  "text-decoration",
  "text-transform",
  "vertical-align",
  "width"
]);
function mjmlAttributeToCssProperty(attr: string): string {
  const attribute = attr
    .trim()
    .toLowerCase()
    .replace(/^tb-/, "");
  for (const shorthand of ["color", "padding", "width", "height", "position"]) {
    if (attribute.includes(shorthand)) return shorthand;
  }
  return attribute;
}

interface EmbeddedRegion {
  languageId?: string;
  start: number;
  end: number;
  onlyPlaceholders: boolean;
  attributeValue?: boolean;
  attributeName?: string | null;
}

/**
 * For template expressions, typescript-template-language-service-decorator
 * will replace them with placeholder `x`'s, when the line does not consist only of
 * expressions and whitespace.
 *
 * This regex can be used to check if CSS content contains only expressions and whitespace.
 */
const onlyPlaceholdersRegex = /^ *x{3,}( *x{3,})* *$/;

function getAttributeLanguage(attributeName?: string | null): string | null {
  if (!attributeName) return null;

  if (MJML_CSS_ATTRIBUTES.has(attributeName.toLowerCase())) return "css";
  const match = /^(style)$|^(on\w+)$/i.exec(attributeName);
  if (!match) {
    return null;
  }
  return match[1] ? "css" : "javascript";
}

function getLanguageAtPosition(
  document: TextDocument,
  regions: EmbeddedRegion[],
  position: Position
): string | undefined {
  const offset = document.offsetAt(position);
  for (const region of regions) {
    if (region.start <= offset) {
      if (offset <= region.end) {
        return region.languageId;
      }
    } else {
      break;
    }
  }
  return "html";
}

function getPrefix(c: EmbeddedRegion): string {
  if (c.attributeValue && !c.onlyPlaceholders) {
    switch (c.languageId) {
      case "css":
        if (
          c.attributeName &&
          MJML_CSS_ATTRIBUTES.has(c.attributeName.toLowerCase())
        )
          return `${CSS_STYLE_RULE}{${mjmlAttributeToCssProperty(
            c.attributeName
          )}:`;
        return `${CSS_STYLE_RULE}{`;
    }
  }
  return "";
}
function getSuffix(c: EmbeddedRegion): string {
  if (c.attributeValue && !c.onlyPlaceholders) {
    switch (c.languageId) {
      case "css":
        return "}";
      case "javascript":
        return ";";
    }
  }
  return "";
}

function append(result: string, str: string, n: number): string {
  while (n > 0) {
    if (n & 1) {
      result += str;
    }
    n >>= 1;
    str += str;
  }
  return result;
}

function substituteWithWhitespace(
  result: string,
  start: number,
  end: number,
  oldContent: string,
  before: string,
  after: string
): string {
  let accumulatedWS = 0;
  result += before;
  for (let i = start + before.length; i < end; i++) {
    const ch = oldContent[i];
    if (ch === "\n" || ch === "\r") {
      // only write new lines, skip the whitespace
      accumulatedWS = 0;
      result += ch;
    } else {
      accumulatedWS++;
    }
  }
  result = append(result, " ", accumulatedWS - after.length);
  result += after;
  return result;
}

function getEmbeddedDocument(
  document: TextDocument,
  contents: EmbeddedRegion[],
  languageId: string,
  ignoreAttributeValues: boolean
): TextDocument {
  let currentPos = 0;
  const oldContent = document.getText();
  let result = "";
  let lastSuffix = "";
  for (const c of contents) {
    if (
      c.languageId === languageId &&
      (!ignoreAttributeValues || !c.attributeValue)
    ) {
      result = substituteWithWhitespace(
        result,
        currentPos,
        c.start,
        oldContent,
        lastSuffix,
        getPrefix(c)
      );
      result += oldContent
        .substring(c.start, c.end)
        .replace(onlyPlaceholdersRegex, match => " ".repeat(match.length));
      currentPos = c.end;
      lastSuffix = getSuffix(c);
    }
  }
  result = substituteWithWhitespace(
    result,
    currentPos,
    oldContent.length,
    oldContent,
    lastSuffix,
    ""
  );
  return TextDocument.create(
    document.uri,
    languageId,
    document.version,
    result
  );
}

function getLanguageRanges(
  document: TextDocument,
  regions: EmbeddedRegion[],
  range: Range
): LanguageRange[] {
  const result: LanguageRange[] = [];
  let currentPos = range ? range.start : Position.create(0, 0);
  let currentOffset = range ? document.offsetAt(range.start) : 0;
  const endOffset = range
    ? document.offsetAt(range.end)
    : document.getText().length;
  for (const region of regions) {
    if (region.end > currentOffset && region.start < endOffset) {
      const start = Math.max(region.start, currentOffset);
      const startPos = document.positionAt(start);
      if (currentOffset < region.start) {
        result.push({
          start: currentPos,
          end: startPos,
          languageId: "html"
        });
      }
      const end = Math.min(region.end, endOffset);
      const endPos = document.positionAt(end);
      if (end > region.start) {
        result.push({
          start: startPos,
          end: endPos,
          languageId: region.languageId,
          attributeValue: region.attributeValue
        });
      }
      currentOffset = end;
      currentPos = endPos;
    }
  }
  if (currentOffset < endOffset) {
    const endPos = range ? range.end : document.positionAt(endOffset);
    result.push({
      start: currentPos,
      end: endPos,
      languageId: "html"
    });
  }
  return result;
}

function getLanguagesInDocument(
  _document: TextDocument,
  regions: EmbeddedRegion[]
): string[] {
  const result = new Set(
    regions
      .filter(({ languageId }) => languageId)
      .map(({ languageId }) => languageId)
  ) as Set<string>;
  result.add("html");
  return [...result];
}

export function getDocumentRegions(
  languageService: LanguageService,
  document: TextDocument
): HTMLDocumentRegions {
  const regions: EmbeddedRegion[] = [];
  // replacing mj-style with equal length style
  const text = document
    .getText()
    .replace(/<mj-style/gi, "<style   ")
    .replace(/<\/mj-style/gi, "</style   ");
  const scanner = languageService.createScanner(text);
  let lastTagName = "";
  let lastAttributeName: string | null = null;
  let languageIdFromType: string | undefined;
  const importedScripts: string[] = [];

  let token = scanner.scan();
  while (token !== TokenType.EOS) {
    switch (token) {
      case TokenType.StartTag:
        lastTagName = scanner.getTokenText();
        lastAttributeName = null;
        languageIdFromType = "javascript";
      case TokenType.Styles:
        regions.push({
          languageId: "css",
          start: scanner.getTokenOffset(),
          end: scanner.getTokenEnd(),
          onlyPlaceholders: onlyPlaceholdersRegex.test(scanner.getTokenText())
        });
        break;
      case TokenType.Script:
        regions.push({
          languageId: languageIdFromType,
          start: scanner.getTokenOffset(),
          end: scanner.getTokenEnd(),
          onlyPlaceholders: onlyPlaceholdersRegex.test(scanner.getTokenText())
        });
        break;
      case TokenType.AttributeName:
        lastAttributeName = scanner.getTokenText();
        break;
      case TokenType.AttributeValue:
        if (
          lastAttributeName === "path" &&
          lastTagName.toLowerCase() === "mj-include"
        ) {
          let value = scanner.getTokenText();
          if (/^['"].+["']$/.test(value)) {
            value = value.slice(1, -1);
          }
          importedScripts.push(value);
        } else if (
          lastAttributeName === "type" &&
          lastTagName.toLowerCase() === "script"
        ) {
          if (
            /["'](module|(text|application)\/(java|ecma)script)["']/.test(
              scanner.getTokenText()
            )
          ) {
            languageIdFromType = "javascript";
          } else {
            languageIdFromType = void 0;
          }
        } else {
          const attributeLanguageId = getAttributeLanguage(lastAttributeName);
          if (attributeLanguageId) {
            let start = scanner.getTokenOffset();
            let end = scanner.getTokenEnd();
            const firstChar = document.getText()[start];
            if (firstChar === "'" || firstChar === '"') {
              start++;
              end--;
            }
            const onlyPlaceholders = onlyPlaceholdersRegex.test(
              document.getText().slice(start, end)
            );
            regions.push({
              languageId: attributeLanguageId,
              start,
              end,
              onlyPlaceholders,
              attributeValue: true,
              attributeName: lastAttributeName
            });
          }
        }
        lastAttributeName = null;
        break;
    }
    token = scanner.scan();
  }
  return {
    getEmbeddedDocument: (
      languageId: string,
      ignoreAttributeValues: boolean
    ): TextDocument =>
      getEmbeddedDocument(document, regions, languageId, ignoreAttributeValues),
    getLanguageAtPosition: (position: Position): string | undefined =>
      getLanguageAtPosition(document, regions, position),
    getLanguageRanges: (range: Range) =>
      getLanguageRanges(document, regions, range),
    getLanguagesInDocument: () => getLanguagesInDocument(document, regions),
    getImportedScripts: () => importedScripts
  };
}
