import type { SupplierOffer } from './ProcurementWorkspace';
import { Card, TableRegion } from '@/app/components/ui';

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });
const offerStatus: Record<string, string> = {
  REQUESTED: 'Запрошено', WAITING_RESPONSE: 'Ожидает ответа', OFFER_RECEIVED: 'Получено',
  NEGOTIATION: 'Переговоры', SELECTED: 'Выбрано', REJECTED: 'Отклонено',
};

function availability(inStock: boolean | null) {
  if (inStock === null) return '—';
  return inStock ? 'В наличии' : 'Под заказ';
}

export default function OfferComparison({ offers, offerAnchor }: {
  offers: SupplierOffer[];
  offerAnchor: (offerId: string) => string;
}) {
  const pricesByItem = new Map<string, Set<string>>();
  for (const offer of offers) for (const item of offer.items ?? []) {
    if (item.unitPrice == null) continue;
    const key = `${item.taskItemId}:${item.currency}`;
    const prices = pricesByItem.get(key) ?? new Set<string>();
    prices.add(String(item.unitPrice));
    pricesByItem.set(key, prices);
  }
  return <Card className="p-4">
    <h3 className="mb-3 font-semibold">Сравнение коммерческих предложений</h3>
    <p className="mb-3 text-sm text-muted">Разные цены за одну позицию в одной валюте выделены цветом.</p>
    <TableRegion label="Сравнение коммерческих предложений">
      <table className="min-w-[57rem] align-top">
        <thead><tr>
          {['Поставщик', 'Позиция', 'Кол-во', 'Цена за ед.', 'Валюта', 'Срок', 'Наличие', 'Примечания', 'Действия'].map((column) =>
            <th key={column} scope="col">{column}</th>)}
        </tr></thead>
        {offers.map((offer) => {
          const items = offer.items?.length ? offer.items : [null];
          return <tbody key={offer.id} className="border-b border-slate-200">
            {items.map((item, index) => {
              const differs = item?.unitPrice != null && (pricesByItem.get(`${item.taskItemId}:${item.currency}`)?.size ?? 0) > 1;
              return <tr key={item?.id ?? offer.id} className="align-top [overflow-wrap:anywhere]">
              {index === 0 && <th scope="rowgroup" rowSpan={items.length} className="min-w-32 font-semibold">
                {offer.supplier.name}<span className="block text-xs font-normal text-muted">{offerStatus[offer.status] ?? offer.status}</span>
              </th>}
              <td className="min-w-36">{item?.taskItem.name ?? '—'}</td>
              <td>{item ? `${number.format(Number(item.quantity))} ${item.taskItem.unit}` : '—'}</td>
              <td className={`whitespace-nowrap tabular-nums ${differs ? 'bg-accent-soft font-semibold' : ''}`}>
                {item?.unitPrice != null ? number.format(Number(item.unitPrice)) : '—'}
                {differs && <span className="sr-only"> · Цена отличается</span>}
              </td>
              <td>{item?.currency ?? '—'}</td>
              {index === 0 && <td rowSpan={items.length} className="whitespace-nowrap">{offer.deliveryDays == null ? '—' : `${offer.deliveryDays} дн.`}</td>}
              <td>{availability(item ? item.inStock : offer.inStock)}</td>
              <td className="min-w-32">{[offer.notes, item?.notes].filter(Boolean).join(' · ') || '—'}</td>
              {index === 0 && <td rowSpan={items.length}>
                <a className="font-medium text-accent underline" href={`#${offerAnchor(offer.id)}`}>К предложению</a>
              </td>}
            </tr>;
            })}
          </tbody>;
        })}
      </table>
    </TableRegion>
  </Card>;
}
