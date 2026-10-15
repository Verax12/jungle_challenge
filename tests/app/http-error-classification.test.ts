import { expect, test } from 'bun:test';
import { errorResponse } from '../../src/adapters/http/financial-error.filter.js';

test.each([
  { type: 'entity.too.large', status: 413, code: 'PAYLOAD_TOO_LARGE' },
  { type: 'charset.unsupported', status: 415, code: 'INVALID_REQUEST' },
  { type: 'encoding.unsupported', status: 415, code: 'INVALID_REQUEST' },
  { type: 'entity.parse.failed', status: 400, code: 'INVALID_REQUEST' },
])('known parser error $type has a safe response', ({ type, status, code }) => {
  const error = Object.assign(new Error('SQL secret-password full-payload'), {
    type,
    status,
    statusCode: status,
    body: '{"secret":"financial-payload"}',
  });
  expect(errorResponse(error)).toEqual({ status, code });
});

test.each([
  {
    label: 'plain object with parser fields',
    error: { type: 'entity.too.large', status: 413, statusCode: 413 },
  },
  {
    label: 'status without parser type',
    error: Object.assign(new Error('internal'), {
      status: 413,
      statusCode: 413,
    }),
  },
  {
    label: 'unknown parser type',
    error: Object.assign(new Error('internal'), {
      type: 'unexpected.failure',
      status: 400,
      statusCode: 400,
    }),
  },
  {
    label: 'known type with unexpected status',
    error: Object.assign(new Error('internal'), {
      type: 'entity.too.large',
      status: 400,
      statusCode: 400,
    }),
  },
  {
    label: 'disagreeing status fields',
    error: Object.assign(new Error('internal'), {
      type: 'charset.unsupported',
      status: 415,
      statusCode: 500,
    }),
  },
  {
    label: 'missing status field',
    error: Object.assign(new Error('internal'), {
      type: 'encoding.unsupported',
      statusCode: 415,
    }),
  },
  {
    label: 'string status fields',
    error: Object.assign(new Error('internal'), {
      type: 'entity.parse.failed',
      status: '400',
      statusCode: '400',
    }),
  },
])('$label remains an internal failure', ({ error }) => {
  expect(errorResponse(error)).toEqual({ status: 500, code: 'INTERNAL_ERROR' });
});
