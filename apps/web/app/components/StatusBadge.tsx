import { Badge } from './ui';

export const taskStatusLabels: Record<string, string> = {
  NEW: 'Новая',
  SEARCHING: 'Поиск поставщика',
  NEGOTIATION: 'Переговоры',
  ORDERED: 'Заказано',
  WAITING_PAYMENT: 'Ожидает оплаты',
  WAITING_SHIPMENT: 'Ожидает отгрузки',
  IN_TRANSIT: 'В пути',
  READY_FOR_PICKUP: 'Готово к получению',
  RECEIVED: 'Получено',
  HANDED_OVER: 'Передано',
  CLOSED: 'Закрыто',
  CANCELLED: 'Отменено',
};

export const requestStatusLabels: Record<string, string> = {
  NEW: 'Новая',
  ACCEPTED: 'Принята',
  APPROVED: 'Принята',
  IN_REVIEW: 'На рассмотрении',
  NEEDS_CLARIFICATION: 'Требует уточнения',
  IN_PROGRESS: 'В работе',
  CONVERTED: 'Передана в закупку',
  REJECTED: 'Отклонена',
  CANCELLED: 'Отменена',
};

const tones: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  SEARCHING: 'info', NEGOTIATION: 'info', ORDERED: 'info', IN_TRANSIT: 'info', READY_FOR_PICKUP: 'info',
  WAITING_PAYMENT: 'warning', WAITING_SHIPMENT: 'warning', NEEDS_CLARIFICATION: 'warning',
  RECEIVED: 'success', HANDED_OVER: 'success', ACCEPTED: 'success', APPROVED: 'success',
  REJECTED: 'danger', CONVERTED: 'info', IN_REVIEW: 'info', IN_PROGRESS: 'info',
};

export function StatusBadge({ status, kind = 'task' }: { status: string; kind?: 'task' | 'request' }) {
  const labels = kind === 'task' ? taskStatusLabels : requestStatusLabels;
  return <Badge tone={tones[status] ?? 'neutral'}>{labels[status] ?? status}</Badge>;
}
