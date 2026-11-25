import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { reportPeriod } from './analytics.service.js';
import { dateRange, ListQuery, SearchQuery } from './discovery.dto.js';
import { contains, ordersWhere, validateFilters } from './discovery.filters.js';
import { decimal } from './discovery.selections.js';
import { encodeCsv, encodeXlsx, ExportService } from './export-file.js';

describe('CORE-11 validation', () => {
  it('checks paging, field allowlists and calendar dates', async () => {
    expect(
      await validate(
        plainToInstance(SearchQuery, { q: ' щуп ', page: '2', pageSize: '10' }),
      ),
    ).toEqual([]);
    expect(
      await validate(
        plainToInstance(SearchQuery, { q: 'я'.repeat(121), pageSize: '101' }),
      ),
    ).toHaveLength(2);
    expect(
      await validate(
        plainToInstance(ListQuery, {
          createdFrom: '2025-02-29',
          sort: 'passwordHash',
        }),
      ),
    ).toHaveLength(2);
    expect(() =>
      validateFilters(
        'suppliers',
        Object.assign(new ListQuery(), { priority: 'HIGH' as const }),
      ),
    ).toThrow();
    expect(() =>
      ordersWhere(
        Object.assign(new ListQuery(), { status: 'NEW' }),
        [],
        new Date(),
      ),
    ).toThrow();
  });

  it('treats LIKE metacharacters as ordinary text and uses inclusive local days', () => {
    expect(contains('Датчик_50%\\').contains).toBe('Датчик\\_50\\%\\\\');
    expect(dateRange('2026-01-02', '2026-01-02')).toEqual({
      gte: new Date('2026-01-01T21:00:00Z'),
      lt: new Date('2026-01-02T21:00:00Z'),
    });
    expect(() => dateRange('2026-02-01', '2026-01-01')).toThrow();
    expect(() =>
      reportPeriod({ from: '2025-01-01', to: '2026-01-02' }, new Date()),
    ).toThrow();
    expect(reportPeriod({}, new Date('2026-01-01T22:00:00Z')).to).toBe(
      '2026-01-02',
    );
  });
});

describe('CORE-11 tabular export', () => {
  it('protects formulas and preserves text, amounts and local dates in CSV and XLSX', async () => {
    const table = {
      headings: ['Название', 'Артикул', 'Дата', 'Количество', 'Точная сумма'],
      rows: [
        [
          ' =1+1',
          'Деталь;"А"',
          new Date('2026-06-01T22:05:10Z'),
          decimal('9999999999.25'),
          decimal('123456789012345.12'),
        ],
        ['\u200B＝1+1', null, null, null, null],
        ['\tТекст', null, null, null, null],
      ],
    };
    const csv = encodeCsv(table);
    expect(csv.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(csv.toString('utf8')).toContain(
      `"' =1+1";"Деталь;""А""";"2026-06-02 01:05:10";9999999999,25;123456789012345,12\r\n`,
    );
    expect(csv.toString('utf8')).toContain("'\u200B＝1+1");
    expect(csv.toString('utf8')).toContain("'\tТекст");

    const files = unzipSync(await encodeXlsx(table));
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    const strings = files['xl/sharedStrings.xml']
      ? strFromU8(files['xl/sharedStrings.xml'])
      : sheet;
    expect(sheet).not.toMatch(/<f(?:[ >])/);
    expect(sheet).toContain('9999999999.25');
    expect(strings).toContain(' =1+1');
    expect(strings).toContain('123456789012345.12');
    expect(strings).toContain('Деталь;');
    expect(strFromU8(files['xl/styles.xml'])).toContain('yyyy-mm-dd hh:mm:ss');
  });

  it('caps concurrent exports, releases rejected slots and limits payload bytes', async () => {
    const service = new ExportService();
    let release!: (value: { headings: string[]; rows: [] }) => void;
    const pending = new Promise<{ headings: string[]; rows: [] }>((resolve) => {
      release = resolve;
    });
    const active = ['first', 'second'].map((name) =>
      service.create(name, 'csv', () => pending),
    );
    await expect(
      service.create('third', 'csv', () => pending),
    ).rejects.toMatchObject({ status: 503 });
    release({ headings: [], rows: [] });
    await Promise.all(active);
    await expect(
      service.create('huge', 'csv', () =>
        Promise.resolve({
          headings: ['Поле'],
          rows: [['Т'.repeat(32768)]],
        }),
      ),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      service.create('next', 'csv', () => pending),
    ).resolves.toBeTruthy();
  });
});
