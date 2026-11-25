'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import PageLayout from '@/app/components/PageLayout';
import { StatusBadge, taskStatusLabels } from '@/app/components/StatusBadge';
import { WorkingTable, WorkingTableControls } from '@/app/components/WorkingTable';
import { Card, Field, Input, Skeleton } from '@/app/components/ui';
import { taskLink } from '@/lib/discovery';
import { useWorkingList, workingLink } from '@/lib/working-list';

type SupplierLink = { supplier: { name: string } } | null;
type RegistryItem = {
  id: string;
  name: string;
  partNumber: string | null;
  quantity: string | number;
  unit: string;
  unitPrice: string | number | null;
  currency: string;
  task: { id: string; number: number; title: string; status: string; selectedOffer: SupplierLink; purchaseOrder: SupplierLink };
};

const quantity = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });
const statuses = Object.entries(taskStatusLabels);
const headers = ['Позиция', 'Количество', 'Сумма', 'Закупка', 'Поставщик', 'Статус'];

function supplier(item: RegistryItem) {
  return item.task.purchaseOrder?.supplier.name ?? item.task.selectedOffer?.supplier.name;
}

function total(item: RegistryItem) {
  const amount = Number(item.unitPrice) * Number(item.quantity);
  if (item.unitPrice == null || !Number.isFinite(amount)) return 'Не указано';
  const { currency } = item;
  return /^[A-Z]{3}$/.test(currency)
    ? amount.toLocaleString('ru-RU', { style: 'currency', currency })
    : amount.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function Registry() {
  const list = useWorkingList<RegistryItem>('items');
  const [legacySearch, setLegacySearch] = useState('');
  const term = list.legacy ? legacySearch.toLocaleLowerCase('ru-RU').trim() : '';
  const items = list.page?.items.filter((item) => !term || [
    item.name, item.partNumber, item.task.title, String(item.task.number), supplier(item),
  ].some((value) => value?.toLocaleLowerCase('ru-RU').includes(term)));
  const page = list.page && items && { ...list.page, items, total: term ? items.length : list.page.total };

  return <PageLayout title="Реестр позиций" subtitle="Номенклатура, количество, стоимость и связанная закупка"
    action={<Link href="/" className="ui-button ui-button--outline">К закупкам</Link>}>
    <div className="min-w-0 space-y-4">
      <WorkingTableControls list={list} statuses={statuses} registry entity="items" />
      {list.legacy && list.page && <Card className="p-4">
        <Field id="registry-search" label="Поиск по реестру">
          <Input type="search" value={legacySearch} onChange={(event) => setLegacySearch(event.target.value)} />
        </Field>
      </Card>}
      <WorkingTable list={{ ...list, page }} label="Реестр позиций" headers={headers} empty="В реестре пока нет позиций" filtered={Boolean(term)}>
        {items?.map((item) => <tr key={item.id}>
          <th scope="row" className="text-left [overflow-wrap:anywhere] md:min-w-44">
            <Link href={taskLink(item.task.id, '/registry', list.query, 'items', item.id)}
              className="text-accent hover:underline">{item.name}</Link>
            <span className="block text-xs text-muted">{item.partNumber || 'Без артикула'}</span>
          </th>
          <td data-label="Количество">
            {Number.isFinite(Number(item.quantity)) ? `${quantity.format(Number(item.quantity))} ${item.unit}` : 'Не указано'}
          </td>
          <td data-label="Сумма">{total(item)}</td>
          <td data-label="Закупка" className="[overflow-wrap:anywhere] md:min-w-48">
            <Link href={workingLink(`/tasks/${item.task.id}`, list.href)} className="text-accent hover:underline">
              №{item.task.number} · {item.task.title}
            </Link>
          </td>
          <td data-label="Поставщик">{supplier(item) || 'Не указан'}</td>
          <td data-label="Статус"><StatusBadge status={item.task.status} /></td>
        </tr>)}
      </WorkingTable>
    </div>
  </PageLayout>;
}

export default function RegistryPage() {
  return <Suspense fallback={<PageLayout title="Реестр позиций"><Skeleton /></PageLayout>}>
    <Registry />
  </Suspense>;
}
