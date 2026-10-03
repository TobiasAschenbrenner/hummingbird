import { HttpError } from '../errors/http-error.ts';
import type {
  ArticleCreationInput,
  ArticlePageInput,
  ArticleUpdateInput,
} from '../models/article.model.ts';
import { isWellFormed } from './credentials.validator.ts';

function readPositiveInteger(value: unknown, fallback: number, maximum: number, field: string) {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'string' ||
    value.length > String(maximum).length ||
    !/^[1-9][0-9]*$/.test(value) ||
    Number(value) > maximum
  ) {
    throw new HttpError(400, `Use a whole number from 1 to ${maximum} for ${field}.`);
  }
  return Number(value);
}

export function parseArticlePage(query: Record<string, unknown>): ArticlePageInput {
  if (Object.keys(query).some((field) => !['page', 'pageSize'].includes(field))) {
    throw new HttpError(400, 'Only page and pageSize query parameters are accepted.');
  }
  return {
    page: readPositiveInteger(query.page, 1, 10_000, 'page'),
    pageSize: readPositiveInteger(query.pageSize, 12, 50, 'pageSize'),
  };
}

export function parseArticleSlug(value: unknown): string {
  if (typeof value !== 'string' || value.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new HttpError(400, 'Use an article slug of 1–80 lowercase letters, digits and hyphens.');
  }
  return value;
}

function isDatabaseId(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2_147_483_647
  );
}

const contentFields = ['title', 'description', 'body', 'categoryId', 'tagIds'];

function readArticleObject(body: unknown, allowed: string[]): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Provide article details in a JSON object.');
  }
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((field) => !allowed.includes(field))) {
    throw new HttpError(400, `Only ${allowed.join(', ')} are accepted.`);
  }
  return input;
}

function readContent(
  input: Record<string, unknown>,
  fields: Record<string, string>,
  requireTags = false,
) {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const articleBody = typeof input.body === 'string' ? input.body : '';
  const tagIds = input.tagIds === undefined && !requireTags ? [] : input.tagIds;
  if (!title || [...title].length > 55 || !isWellFormed(title) || /\p{Cc}/u.test(title)) {
    fields.title = 'Use 1–55 characters without control characters.';
  }
  if (
    !description ||
    [...description].length > 250 ||
    !isWellFormed(description) ||
    /\p{Cc}/u.test(description)
  ) {
    fields.description = 'Use 1–250 characters without control characters.';
  }
  if (
    !articleBody.trim() ||
    [...articleBody].length > 20_000 ||
    !isWellFormed(articleBody) ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(articleBody)
  ) {
    fields.body =
      'Use 1–20,000 characters; only tabs and line breaks are allowed as control characters.';
  }
  if (!isDatabaseId(input.categoryId)) fields.categoryId = 'Select an existing category.';
  if (
    !Array.isArray(tagIds) ||
    tagIds.length > 10 ||
    !tagIds.every(isDatabaseId) ||
    new Set(tagIds).size !== tagIds.length
  ) {
    fields.tagIds = 'Select up to 10 distinct existing tags.';
  }
  return {
    title,
    description,
    body: articleBody,
    categoryId: input.categoryId as number,
    tagIds: tagIds as number[],
  };
}

export function parseArticleCreation(body: unknown): ArticleCreationInput {
  const input = readArticleObject(body, ['slug', ...contentFields]);
  const fields: Record<string, string> = {};
  const slug = typeof input.slug === 'string' ? input.slug : '';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80) {
    fields.slug = 'Use 1–80 lowercase letters, digits and single hyphens.';
  }
  const content = readContent(input, fields);
  if (Object.keys(fields).length)
    throw new HttpError(400, 'Please check your article details.', fields);
  return { slug, ...content };
}

export function parseArticleUpdate(body: unknown): ArticleUpdateInput {
  const input = readArticleObject(body, [...contentFields, 'version']);
  const fields: Record<string, string> = {};
  const version = input.version;
  if (
    typeof version !== 'string' ||
    !/^[1-9][0-9]{0,18}$/.test(version) ||
    BigInt(version) > 9_223_372_036_854_775_807n
  ) {
    fields.version = 'Supply the current article version as a positive bigint string.';
  }
  const content = readContent(input, fields, true);
  if (Object.keys(fields).length)
    throw new HttpError(400, 'Please check your article details.', fields);
  return { ...content, version: version as string };
}
