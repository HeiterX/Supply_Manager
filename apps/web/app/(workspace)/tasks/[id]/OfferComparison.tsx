import type { SupplierOffer } from './ProcurementWorkspace';
import { Card, TableRegion } from '@/app/components/ui';

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });

function availability(inStock: boolean | null) {
  if (inStock === null) return '—';
  return inStock ? 'В наличии' : 'Под заказ';
}

export default function OfferComparison({ offers, offerAnchor }: {
  offers: SupplierOffer[];
  offerAnchor: (offerId: string) => string;
}) {
  return <Card className="p-4">
    <h3 className="mb-3 font-semibold">Сравнение коммерческих предложений</h3>
    <TableRegion label="Сравнение коммерческих предложений">
      <table className="min-w-[57rem] align-top">
        <thead><tr>
          {['Поставщик', 'Позиция', 'Кол-во', 'Цена за ед.', 'Валюта', 'Срок', 'Наличие', 'Условия', 'Действия'].map((column) =>
            <th key={column} scope="col">{column}</th>)}
        </tr></thead>
        {offers.map((offer) => {
          const items = offer.items?.length ? offer.items : [null];
          return <tbody key={offer.id} className="border-b border-slate-200">
            {items.map((item, index) => <tr key={item?.id ?? offer.id} className="align-top">
              {index === 0 && <th scope="rowgroup" rowSpan={items.length} className="min-w-32 font-semibold">{offer.supplier.name}</th>}
              <td className="min-w-36">{item?.taskItem.name ?? '—'}</td>
              <td>{item ? `${number.format(Number(item.quantity))} ${item.taskItem.unit}` : '—'}</td>
              <td className="whitespace-nowrap tabular-nums">{item?.unitPrice != null ? number.format(Number(item.unitPrice)) : '—'}</td>
              <td>{item?.currency ?? '—'}</td>
              {index === 0 && <td rowSpan={items.length} className="whitespace-nowrap">{offer.deliveryDays == null ? '—' : `${offer.deliveryDays} дн.`}</td>}
              <td>{availability(item ? item.inStock : offer.inStock)}</td>
              <td className="min-w-32">{[offer.notes, item?.notes].filter(Boolean).join(' · ') || '—'}</td>
              {index === 0 && <td rowSpan={items.length}>
                <a className="font-medium text-accent underline" href={`#${offerAnchor(offer.id)}`}>К предложению</a>
              </td>}
            </tr>)}
          </tbody>;
        })}
      </table>
    </TableRegion>
  </Card>;
}
