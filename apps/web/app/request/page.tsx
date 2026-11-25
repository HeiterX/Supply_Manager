'use client';

import { Alert, Button, Card } from '@/app/components/ui';

import { Input, Textarea } from '@/app/components/ui';

import { FormEvent, useRef, useState } from 'react';

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

type RequestItem = {
  key: string;
  name: string;
  quantity: string;
  unit: string;
  description: string;
  photo: File | null;
  photoPreview: string | null;
};

type CreatedRequestItem = {
  id: string;
  sortOrder: number;
};

type CreatedRequest = {
  id: string;
  number: number;
  items: CreatedRequestItem[];
};

type CreatedRequestResponse = CreatedRequest & { uploadToken: string };

function createEmptyItem(key = crypto.randomUUID()): RequestItem {
  return {
    key,
    name: '',
    quantity: '1',
    unit: 'шт.',
    description: '',
    photo: null,
    photoPreview: null,
  };
}

function getErrorMessage(data: unknown) {
  if (!data || typeof data !== 'object') {
    return 'Не удалось отправить заявку';
  }

  const message = (data as { message?: unknown }).message;

  if (Array.isArray(message)) {
    return message.join('. ');
  }

  if (typeof message === 'string') {
    return message;
  }

  return 'Не удалось отправить заявку';
}

export default function RequestPage() {
  const [requesterName, setRequesterName] = useState('');
  const [items, setItems] = useState<RequestItem[]>([
    createEmptyItem('initial-item'),
  ]);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdRequest, setCreatedRequest] =
    useState<CreatedRequest | null>(null);
  const [photoWarning, setPhotoWarning] = useState('');

  function updateItem(
    key: string,
    field: 'name' | 'quantity' | 'unit' | 'description',
    value: string,
  ) {
    setItems((current) =>
      current.map((item) =>
        item.key === key ? { ...item, [field]: value } : item,
      ),
    );

    if (error) {
      setError('');
    }
  }

  function selectPhoto(key: string, file: File | null) {
    setError('');

    setItems((current) =>
      current.map((item) => {
        if (item.key !== key) {
          return item;
        }

        if (item.photoPreview) {
          URL.revokeObjectURL(item.photoPreview);
        }

        if (!file) {
          return {
            ...item,
            photo: null,
            photoPreview: null,
          };
        }

        const allowedTypes = [
          'image/jpeg',
          'image/png',
          'image/webp',
        ];

        if (!allowedTypes.includes(file.type)) {
          setError('Можно прикреплять фотографии JPG, PNG или WebP');
          return item;
        }

        if (file.size > 8 * 1024 * 1024) {
          setError('Размер фотографии не должен превышать 8 МБ');
          return item;
        }

        return {
          ...item,
          photo: file,
          photoPreview: URL.createObjectURL(file),
        };
      }),
    );
  }

  function addItem() {
    setItems((current) => [...current, createEmptyItem()]);

    setTimeout(() => {
      window.scrollBy({
        top: 240,
        behavior: 'smooth',
      });
    }, 50);
  }

  function removeItem(key: string) {
    setItems((current) => {
      const item = current.find((candidate) => candidate.key === key);

      if (item?.photoPreview) {
        URL.revokeObjectURL(item.photoPreview);
      }

      return current.filter((candidate) => candidate.key !== key);
    });
  }

  async function uploadPhotos(
    request: CreatedRequestResponse,
    submittedItems: RequestItem[],
  ) {
    const orderedCreatedItems = [...request.items].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );

    let failedPhotos = 0;

    for (let index = 0; index < submittedItems.length; index += 1) {
      const photo = submittedItems[index].photo;
      const createdItem = orderedCreatedItems[index];

      if (!photo) {
        continue;
      }
      if (
        !createdItem ||
        typeof request.uploadToken !== 'string' ||
        !request.uploadToken
      ) {
        failedPhotos += 1;
        continue;
      }

      const formData = new FormData();
      formData.append('photo', photo);

      try {
        const response = await fetch(
          `${API_URL}/purchase-requests/public/${request.id}/items/${createdItem.id}/photo`,
          {
            method: 'POST',
            headers: { 'X-Upload-Token': request.uploadToken },
            body: formData,
          },
        );

        if (!response.ok) {
          failedPhotos += 1;
        }
      } catch {
        failedPhotos += 1;
      }
    }

    return failedPhotos;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setPhotoWarning('');

    const normalizedName = requesterName.trim();

    if (normalizedName.length < 2) {
      setError('Укажите, кто подаёт заявку');
      return;
    }

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];

      if (!item.name.trim()) {
        setError(`Укажите название позиции ${index + 1}`);
        return;
      }

      const quantity = Number(item.quantity.replace(',', '.'));

      if (!Number.isFinite(quantity) || quantity <= 0) {
        setError(`Укажите корректное количество для позиции ${index + 1}`);
        return;
      }

      if (!item.unit.trim()) {
        setError(`Укажите единицу измерения для позиции ${index + 1}`);
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const submittedItems = [...items];

      const response = await fetch(
        `${API_URL}/purchase-requests/public`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requesterName: normalizedName,
            items: submittedItems.map((item) => ({
              name: item.name.trim(),
              quantity: Number(item.quantity.replace(',', '.')),
              unit: item.unit.trim(),
              description: item.description.trim() || undefined,
            })),
          }),
        },
      );

      const data = (await response.json().catch(() => null)) as
        | CreatedRequest
        | { message?: unknown }
        | null;

      if (!response.ok) {
        throw new Error(getErrorMessage(data));
      }

      if (
        !data ||
        typeof data !== 'object' ||
        !('id' in data) ||
        !('number' in data) ||
        !('items' in data)
      ) {
        throw new Error('Сервер вернул некорректный ответ');
      }

      const request = data as CreatedRequestResponse;

      const failedPhotos = await uploadPhotos(
        request,
        submittedItems,
      );

      if (failedPhotos > 0) {
        setPhotoWarning(
          failedPhotos === 1
            ? 'Заявка создана, но одну фотографию загрузить не удалось.'
            : `Заявка создана, но не удалось загрузить фотографий: ${failedPhotos}.`,
        );
      }

      // Do not retain the short-lived upload credential in React state.
      setCreatedRequest({
        id: request.id,
        number: request.number,
        items: request.items,
      });

      window.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Не удалось отправить заявку',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function createAnotherRequest() {
    items.forEach((item) => {
      if (item.photoPreview) {
        URL.revokeObjectURL(item.photoPreview);
      }
    });

    setRequesterName('');
    setItems([createEmptyItem()]);
    setCreatedRequest(null);
    setPhotoWarning('');
    setError('');

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }

  if (createdRequest) {
    return (
      <main className="min-h-screen bg-background px-4 py-6 sm:px-6 sm:py-10">
        <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-xl items-center justify-center">
          <section className="w-full rounded-[28px] border border-slate-200 bg-white px-5 py-8 shadow-sm sm:px-9 sm:py-10">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="h-8 w-8 text-emerald-600"
                aria-hidden="true"
              >
                <path
                  d="m5 12 4 4L19 6"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <div className="mt-6 text-center">
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
                Заявка отправлена
              </h1>

              <div className="mt-5 inline-flex rounded-2xl bg-[#eef2ff] px-5 py-3">
                <span className="text-lg font-bold text-accent">
                  Заявка № {createdRequest.number}
                </span>
              </div>

              <p className="mx-auto mt-5 max-w-sm text-sm leading-6 text-slate-500 sm:text-base">
                Заявка передана в отдел снабжения и сохранена в системе.
              </p>
            </div>

            {photoWarning && (
              <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-5 text-amber-800">
                {photoWarning}
                <br />
                Сама заявка уже сохранена — отправлять её повторно не нужно.
              </div>
            )}

            <button
              type="button"
              onClick={createAnotherRequest}
              className="ui-button ui-button--primary mt-7 flex h-13 w-full items-center justify-center px-5 text-[15px] font-semibold transition active:scale-[0.99]"
            >
              Отправить ещё одну заявку
            </button>

            <p className="mt-5 text-center text-xs leading-5 text-slate-400">
              Сохраните номер заявки, если он понадобится для уточнения.
            </p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-slate-950">
      <header className="border-b border-slate-200/80 bg-white">
        <div className="mx-auto flex max-w-3xl items-center px-4 py-4 sm:px-6">
          <div className="brand-mark" aria-hidden="true">
            SM
          </div>

          <div className="ml-3 min-w-0">
            <div className="truncate text-sm font-bold text-slate-950">
              Supply Manager
            </div>
            <div className="text-xs text-slate-500">
              Заявка на закупку
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <section className="mb-6 sm:mb-8">
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            Подать заявку
          </h1>

          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
            Укажите необходимые позиции. При необходимости добавьте описание
            и фотографию детали, маркировки или шильдика.
          </p>
        </section>

        <form onSubmit={handleSubmit}>
          <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-800">
                Кто подаёт заявку?
                <span className="ml-1 text-red-500">*</span>
              </span>

              <Input
                type="text"
                value={requesterName}
                onChange={(event) => {
                  setRequesterName(event.target.value);
                  setError('');
                }}
                placeholder="Иванов Иван Иванович"
                autoComplete="name"
                maxLength={120}
              />
            </label>
          </section>

          <div className="mt-5 space-y-4">
            {items.map((item, index) => (
              <ItemCard
                key={item.key}
                item={item}
                index={index}
                canDelete={items.length > 1}
                onChange={(field, value) =>
                  updateItem(item.key, field, value)
                }
                onPhoto={(file) => selectPhoto(item.key, file)}
                onDelete={() => removeItem(item.key)}
              />
            ))}
          </div>

          {items.length < 20 && (
            <button
              type="button"
              onClick={addItem}
              className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[#9eb0f8] bg-[#f8f9ff] px-4 text-sm font-semibold text-accent transition active:scale-[0.99] sm:hover:bg-[#f0f3ff]"
            >
              <span className="text-xl font-normal leading-none">+</span>
              Добавить ещё позицию
            </button>
          )}

          {error && <div className="mt-5"><Alert tone="danger">{error}</Alert></div>}

          <Card className="mt-6 p-4 sm:p-6">
            <Button type="submit" loading={isSubmitting} className="w-full">
              {isSubmitting ? "Отправляем…" : "Отправить заявку"}
            </Button>

            <p className="mt-3 text-center text-xs leading-5 text-slate-400">
              После отправки заявка сразу поступит в систему снабжения
            </p>
          </Card>
        </form>

        <footer className="py-7 text-center text-xs text-slate-400">
          Supply Manager · Система управления снабжением
        </footer>
      </div>
    </main>
  );
}

function ItemCard({
  item,
  index,
  canDelete,
  onChange,
  onPhoto,
  onDelete,
}: {
  item: RequestItem;
  index: number;
  canDelete: boolean;
  onChange: (
    field: 'name' | 'quantity' | 'unit' | 'description',
    value: string,
  ) => void;
  onPhoto: (file: File | null) => void;
  onDelete: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <section className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#eef2ff] text-xs font-bold text-accent">
            {index + 1}
          </span>

          <span className="text-sm font-semibold text-slate-800">
            Позиция {index + 1}
          </span>
        </div>

        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-400 transition hover:bg-red-50 hover:text-red-600"
          >
            Удалить
          </button>
        )}
      </div>

      <div className="space-y-5 p-4 sm:p-6">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-800">
            Что необходимо купить?
            <span className="ml-1 text-red-500">*</span>
          </span>

          <Input
            type="text"
            value={item.name}
            onChange={(event) => onChange('name', event.target.value)}
            placeholder="Например, подшипник SKF 6205"
            maxLength={250}
          />
        </label>

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(105px,0.65fr)] gap-3 sm:grid-cols-2">
          <label className="block min-w-0">
            <span className="mb-2 block text-sm font-medium text-slate-800">
              Количество
              <span className="ml-1 text-red-500">*</span>
            </span>

            <Input
              type="text"
              inputMode="decimal"
              value={item.quantity}
              onChange={(event) =>
                onChange('quantity', event.target.value)
              }
              placeholder="1"
            />
          </label>

          <label className="block min-w-0">
            <span className="mb-2 block text-sm font-medium text-slate-800">
              Ед. изм.
              <span className="ml-1 text-red-500">*</span>
            </span>

            <Input
              type="text"
              value={item.unit}
              onChange={(event) => onChange('unit', event.target.value)}
              placeholder="шт."
              list={`units-${item.key}`}
              maxLength={50}
            />

            <datalist id={`units-${item.key}`}>
              <option value="шт." />
              <option value="компл." />
              <option value="кг" />
              <option value="г" />
              <option value="л" />
              <option value="м" />
              <option value="м²" />
              <option value="упак." />
            </datalist>
          </label>
        </div>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-800">
            Подробное описание
          </span>

          <Textarea
            value={item.description}
            onChange={(event) =>
              onChange('description', event.target.value)
            }
            placeholder="Характеристики, назначение, маркировка, допустимые аналоги или другая полезная информация"
            rows={4}
            maxLength={3000}
          />
        </label>

        <div>
          <div className="mb-2 text-sm font-medium text-slate-800">
            Фото
            <span className="ml-1 font-normal text-slate-400">
              необязательно
            </span>
          </div>

          <Input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              onPhoto(file);
              event.target.value = '';
            }}
          />

          {item.photoPreview ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="relative bg-slate-100">
                {/* Browser-owned blob preview: keep natural dimensions and bypass server optimization. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.photoPreview}
                  alt={`Фото позиции ${index + 1}`}
                  className="max-h-72 w-full object-contain"
                />
              </div>

              <div className="flex items-center justify-between gap-3 bg-white p-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-slate-700">
                    {item.photo?.name}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {item.photo
                      ? `${(item.photo.size / 1024 / 1024).toFixed(1)} МБ`
                      : ''}
                  </p>
                </div>

                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600"
                  >
                    Заменить
                  </button>

                  <button
                    type="button"
                    onClick={() => onPhoto(null)}
                    className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-600"
                  >
                    Удалить
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-28 w-full items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center transition active:bg-slate-100 sm:hover:border-[#8da3fa] sm:hover:bg-[#f8f9ff]"
            >
              <span>
                <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-white text-accent shadow-sm">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    className="h-5 w-5"
                    aria-hidden="true"
                  >
                    <path
                      d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1-2h6l1 2h1.5A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-8Z"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinejoin="round"
                    />
                    <circle
                      cx="12"
                      cy="12.5"
                      r="3"
                      stroke="currentColor"
                      strokeWidth="1.8"
                    />
                  </svg>
                </span>

                <span className="mt-2 block text-sm font-semibold text-slate-700">
                  Добавить фото
                </span>

                <span className="mt-1 block text-xs leading-5 text-slate-400">
                  Сделайте фото или выберите из галереи
                  <br />
                  JPG, PNG или WebP · до 8 МБ
                </span>
              </span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
