'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, Card, Field, Input, Textarea } from '@/app/components/ui';
import { apiFetch } from '@/lib/api-client';
import { workingError } from '@/lib/working-list';

type Item = { id: number; name: string; quantity: string; unit: string; description: string; photo: File | null };
type Created = { id: string; number: number; items: { id: string; sortOrder: number }[]; uploadToken: string };
type Upload = { id: string; file: File; itemId: string };
const steps = ['Заявитель', 'Комплектующие', 'Фотографии', 'Проверка'];
const newItem = (id: number): Item => ({ id, name: '', quantity: '1', unit: 'шт.', description: '', photo: null });

function Preview({ file, alt }: { file: File; alt: string }) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const element = image.current;
    const url = URL.createObjectURL(file);
    if (element) element.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  // The preview is a browser-owned object URL.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={image} alt={alt} className="mt-3 max-h-64 w-full rounded-lg bg-surface-subtle object-contain" />;
}

function itemErrors(item: Item) {
  return {
    name: item.name.trim() ? undefined : 'Укажите наименование.',
    quantity: /^\d+(?:[.,]\d{1,3})?$/.test(item.quantity.trim()) && +item.quantity.trim().replace(',', '.') > 0
      && +item.quantity.trim().replace(',', '.') < 100_000_000_000 ? undefined : 'Введите положительное число с точностью до тысячных.',
    unit: item.unit.trim() ? undefined : 'Укажите единицу измерения.',
  };
}

export default function RequestWizard() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [items, setItems] = useState([newItem(1)]);
  const [validated, setValidated] = useState(false);
  const [photoErrors, setPhotoErrors] = useState<Record<number, string>>({});
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [number, setNumber] = useState<number>();
  const [progress, setProgress] = useState('');
  const [failed, setFailed] = useState(0);
  const [canRetryPhotos, setCanRetryPhotos] = useState(false);
  const sequence = useRef(1);
  const lock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const uploads = useRef<{ token: string; pending: Upload[] } | null>(null);
  const dirty = Boolean(name || items.length > 1 || items.some((item) => item.name || item.description || item.photo || item.quantity !== '1' || item.unit !== 'шт.'));

  useEffect(() => {
    if (!dirty || number !== undefined) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, number]);

  function navigate(next: number) {
    setStep(next);
    setValidated(false);
    heading.current?.focus();
  }

  function update(id: number, change: Partial<Item>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...change } : item));
  }

  function photo(item: Item, file: File | null) {
    const message = file && !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ? 'Выберите JPG, PNG или WebP.'
      : file && (file.size === 0 || file.size > 8 * 1024 * 1024) ? 'Размер файла должен быть от 1 байта до 8 МБ.' : '';
    setPhotoErrors((current) => ({ ...current, [item.id]: message }));
    if (!message) update(item.id, { photo: file });
  }

  async function upload() {
    const current = uploads.current;
    if (!current) return;
    const remaining: Upload[] = [];
    for (const [index, entry] of current.pending.entries()) {
      setProgress(`Загружаем фото ${index + 1} из ${current.pending.length}`);
      const body = new FormData();
      body.append('photo', entry.file);
      try {
        const response = await apiFetch(`/purchase-requests/public/${entry.id}/items/${entry.itemId}/photo`, {
          method: 'POST', headers: { 'X-Upload-Token': current.token }, body,
        });
        if (!response.ok) remaining.push(entry);
      } catch { remaining.push(entry); }
    }
    uploads.current = remaining.length ? { token: current.token, pending: remaining } : null;
    setFailed(remaining.length);
    setCanRetryPhotos(remaining.length > 0);
    setProgress('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || uncertain) return;
    if (step === 0 && name.trim().length < 2 || step === 1 && items.some((item) => Object.values(itemErrors(item)).some(Boolean))) {
      setValidated(true);
      return;
    }
    if (step < 3) { navigate(step + 1); return; }

    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch('/purchase-requests/public', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requesterName: name.trim(), items: items.map((item) => ({
          name: item.name.trim(), quantity: Number(item.quantity.replace(',', '.')), unit: item.unit.trim(),
          description: item.description.trim() || undefined,
        })) }),
      });
      if (!response.ok && response.status < 500) {
        setError(await workingError(response, 'Заявка не принята. Проверьте введённые данные.'));
        return;
      }
      if (!response.ok) throw new Error();
      const created = await response.json() as Created;
      if (!created.id || !Number.isInteger(created.number) || !Array.isArray(created.items)) throw new Error();
      setNumber(created.number);
      const lines = [...created.items].sort((a, b) => a.sortOrder - b.sortOrder);
      const pending = items.flatMap((item, index) => item.photo && lines[index]
        ? [{ id: created.id, itemId: lines[index].id, file: item.photo }] : []);
      if (created.uploadToken && pending.length) {
        uploads.current = { token: created.uploadToken, pending };
        await upload();
      } else {
        setFailed(items.filter((item) => item.photo).length);
      }
      setName('');
      setItems([newItem(++sequence.current)]);
    } catch {
      setUncertain(true);
      setError('Подтверждение не получено. Уточните в отделе снабжения, зарегистрирована ли заявка.');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function retryPhotos() {
    if (lock.current || !uploads.current) return;
    lock.current = true;
    setBusy(true);
    try { await upload(); } finally { lock.current = false; setBusy(false); }
  }

  return <main className="min-h-screen bg-background px-4 py-6 sm:px-6 sm:py-10">
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center gap-3"><span className="brand-mark" aria-hidden="true">SM</span><span className="font-semibold">Supply Manager</span></div>
      {number !== undefined ? <Card className="space-y-4 p-5 sm:p-7">
        <h1 className="text-2xl font-bold">Заявка №{number} отправлена</h1>
        <p className="text-sm text-muted">Сохраните номер для обращений в отдел снабжения.</p>
        {progress && <Alert>{progress}</Alert>}
        {failed > 0 && <Alert tone="warning">Заявка сохранена. Фотографий с ошибкой загрузки: {failed}.</Alert>}
        <div className="flex flex-wrap gap-2">
          {failed > 0 && canRetryPhotos && <Button loading={busy} onClick={() => void retryPhotos()}>Повторить загрузку фото</Button>}
          <Button variant="outline" disabled={busy} onClick={() => {
            uploads.current = null; setNumber(undefined); setFailed(0); setCanRetryPhotos(false); setPhotoErrors({}); setError(''); navigate(0);
          }}>Подать ещё заявку</Button>
        </div>
      </Card> : <>
        <h1 className="text-2xl font-bold sm:text-3xl">Подать заявку</h1>
        <ol aria-label="Этапы заявки" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {steps.map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined}>
            <Badge tone={index === step ? 'info' : 'neutral'}>{index + 1}. {label}</Badge>
          </li>)}
        </ol>
        <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">{steps[step]}</h2>
        <form noValidate onSubmit={submit} className="space-y-4">
          <fieldset disabled={busy || uncertain} className="min-w-0 space-y-4">
            {step === 0 && <Card className="p-4 sm:p-6">
              <Field id="request-name" label="Имя и фамилия заявителя" error={validated && name.trim().length < 2 ? 'Введите имя заявителя.' : undefined}>
                <Input id="request-name" autoComplete="name" required maxLength={120} value={name}
                  aria-invalid={validated && name.trim().length < 2} aria-describedby={validated && name.trim().length < 2 ? 'request-name-error' : undefined}
                  onChange={(event) => setName(event.target.value)} />
              </Field>
            </Card>}
            {step === 1 && <>
              {items.map((item, index) => {
                const errors = validated ? itemErrors(item) : { name: undefined, quantity: undefined, unit: undefined };
                const id = (field: string) => `request-${item.id}-${field}`;
                return <Card key={item.id} className="space-y-4 p-4 sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">Позиция {index + 1}</h3>
                    {items.length > 1 && <Button variant="ghost" onClick={() => setItems((current) => current.filter(({ id }) => id !== item.id))}>Удалить позицию {index + 1}</Button>}
                  </div>
                  {(['name', 'quantity', 'unit'] as const).map((field) => <Field key={field} id={id(field)}
                    label={{ name: 'Наименование', quantity: 'Количество', unit: 'Единица измерения' }[field]} error={errors[field]}>
                    <Input id={id(field)} required value={item[field]} maxLength={{ name: 250, quantity: 16, unit: 50 }[field]}
                      inputMode={field === 'quantity' ? 'decimal' : 'text'} aria-invalid={Boolean(errors[field])}
                      aria-describedby={errors[field] ? `${id(field)}-error` : undefined}
                      onChange={(event) => update(item.id, { [field]: event.target.value })} />
                  </Field>)}
                  <Field id={id('description')} label="Характеристики и комментарий">
                    <Textarea id={id('description')} rows={3} maxLength={3000} value={item.description}
                      placeholder="Артикул, маркировка, параметры или допустимые аналоги"
                      onChange={(event) => update(item.id, { description: event.target.value })} />
                  </Field>
                </Card>;
              })}
              {items.length < 20 && <Button variant="outline" onClick={() => {
                const item = newItem(++sequence.current); setItems((current) => [...current, item]);
              }}>Добавить позицию</Button>}
            </>}
            {step === 2 && <>
              <p className="text-sm text-muted">По одному фото на позицию. JPG, PNG или WebP до 8 МБ. Этот шаг можно пропустить.</p>
              {items.map((item) => <Card key={item.id} className="p-4 [overflow-wrap:anywhere]">
                <Field id={`photo-${item.id}`} label={`Фото · ${item.name}`} error={photoErrors[item.id]}>
                  <Input id={`photo-${item.id}`} type="file" accept="image/jpeg,image/png,image/webp"
                    aria-invalid={Boolean(photoErrors[item.id])} aria-describedby={photoErrors[item.id] ? `photo-${item.id}-error` : undefined}
                    onChange={(event) => { photo(item, event.target.files?.[0] ?? null); event.target.value = ''; }} />
                </Field>
                {item.photo && <>
                  <Preview file={item.photo} alt={`Фото позиции ${item.name}`} />
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    <span>{item.photo.name}</span><Button variant="ghost" onClick={() => photo(item, null)}>Удалить фото</Button>
                  </div>
                </>}
              </Card>)}
            </>}
            {step === 3 && <Card className="space-y-4 p-4 [overflow-wrap:anywhere] sm:p-6">
              <p><span className="text-muted">Заявитель · </span><span>{name.trim()}</span></p>
              <ul className="space-y-3">
                {items.map((item) => <li key={item.id} className="border-t border-border pt-3">
                  <p className="font-semibold">{item.name.trim()} · {item.quantity} {item.unit}</p>
                  {item.description && <p className="whitespace-pre-wrap text-sm">{item.description}</p>}
                  <p className="text-sm text-muted">{item.photo?.name ?? 'Фото отсутствует'}</p>
                </li>)}
              </ul>
              <p className="text-sm text-muted">После подтверждения заявка поступит в отдел снабжения.</p>
            </Card>}
          </fieldset>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex flex-wrap justify-between gap-2">
            {step > 0 && <Button variant="outline" disabled={busy || uncertain} onClick={() => navigate(step - 1)}>Назад</Button>}
            <Button type="submit" className="ml-auto" loading={busy} disabled={uncertain}>{step < 3 ? 'Продолжить' : 'Отправить заявку'}</Button>
          </div>
        </form>
      </>}
    </div>
  </main>;
}
