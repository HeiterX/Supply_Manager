import type { SupplierOffer, TaskItem } from './ProcurementWorkspace';

type OfferComparisonProps = {
  offers: SupplierOffer[];
  items: TaskItem[];
  offerAnchor: (id: string) => string;
  formatMoney: (value: string | number | null, currency: string | null) => string;
  formatQuantity: (value: string | number) => string;
  formatDate: (value: string | null) => string;
};

export default function OfferComparison({
  offers, items, offerAnchor, formatMoney, formatQuantity, formatDate,
}: OfferComparisonProps) {
  return (
    <section className="ui-card overflow-x-auto p-4" aria-label="Сравнение коммерческих предложений">
      <h3 className="font-semibold text-slate-900">Сравнение КП по позициям</h3>
      <p className="mt-1 text-xs text-slate-500">Автоматического выбора нет; валюты не конвертируются, неизвестные цены и условия отмечены явно.</p>
      <table className="mt-4 w-full min-w-[650px] text-left text-xs">
        <thead className="border-b border-slate-200">
          <tr><th className="p-2">Потребность</th>{offers.map(offer => (
            <th key={offer.id} className="min-w-[175px] p-2">
              <a href={`#${offerAnchor(offer.id)}`} className="underline">{offer.supplier.name}</a><span className="block font-normal text-slate-500">v{offer.version} · {offer.currency ?? 'валюта не указана'}</span>
            </th>
          ))}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map(item => <tr key={item.id}>
            <td className="p-2 font-semibold">{item.name}
              <span className="block font-normal text-slate-500">Требуется {formatQuantity(item.quantity)} {item.unit}</span>
            </td>
            {offers.map(o => {
              const line = o.items.find(i => i.taskItemId === item.id);
              return <td key={o.id} className="p-2">
                {!line ? 'Не предложено' : <>
                  <div className="font-semibold">{formatMoney(line.unitPrice, o.currency)} / {item.unit}</div>
                  <div className="mt-1 text-slate-500">{formatQuantity(line.quantity)} {item.unit}</div>
                  <div className="text-slate-500">{line.inStock === null ? 'Наличие не указано' : line.inStock ? 'В наличии' : 'Под заказ'}</div>
                </>}
              </td>;
            })}
          </tr>)}
          <tr className="bg-slate-50">
            <td className="p-2 font-semibold">Условия КП</td>
            {offers.map(o => <td key={o.id} className="p-2">
              <div>Поставка: {o.deliveryDays === null ? 'не указана' : `${o.deliveryDays} дн.`}</div>
              <div>Оплата: {o.paymentTerms || 'не указана'}</div>
              <div>Доставка: {o.deliveryTerms || 'не указана'}</div>
              <div>Действует до: {o.validUntil ? formatDate(o.validUntil) : 'не указано'}</div>
              <div className="mt-1 font-semibold">Товары: {formatMoney(o.price, o.currency)}</div>
            </td>)}
          </tr>
        </tbody>
      </table>
    </section>
  );
}
