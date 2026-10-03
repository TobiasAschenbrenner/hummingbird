import { ValidatorFn } from '@angular/forms';

import { CatalogEntry } from '../models/catalog.model';
import { isArticleSlug } from './article.validator';

export const articleSlug: ValidatorFn = (control) =>
  isArticleSlug(control.value) ? null : { slug: true };

function articleText(maximum: number, preserveWhitespace: boolean): ValidatorFn {
  return (control) => {
    if (typeof control.value !== 'string') return { articleText: true };
    const value = preserveWhitespace ? control.value : control.value.trim();
    const controls = preserveWhitespace
      ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u
      : /\p{Cc}/u;
    return value.trim() &&
      [...value].length <= maximum &&
      !/[\uD800-\uDFFF]/u.test(value) &&
      !controls.test(value)
      ? null
      : { articleText: true };
  };
}

export const articleTitle = articleText(55, false);
export const articleDescription = articleText(250, false);
export const articleBody = articleText(20_000, true);

export function selectedCategory(entries: () => CatalogEntry[]): ValidatorFn {
  return (control) =>
    entries().some((item) => item.id === control.value) ? null : { category: true };
}

export function selectedTags(entries: () => CatalogEntry[]): ValidatorFn {
  return (control) => {
    const value: unknown = control.value;
    return Array.isArray(value) &&
      value.length <= 10 &&
      new Set(value).size === value.length &&
      value.every((id) => entries().some((item) => item.id === id))
      ? null
      : { tags: true };
  };
}
