import { Alert, Button } from './ui';

export default function LoadError({ message, retry }: { message: string; retry: () => void }) {
  return <Alert tone="danger">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span>{message}</span>
      <Button variant="outline" onClick={retry}>Повторить</Button>
    </div>
  </Alert>;
}
