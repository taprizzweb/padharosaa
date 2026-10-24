import { redirect } from 'next/navigation';

// There is one desk now: every request and every food order arrives there. Old bookmarks land on it.
export default function Page() {
  redirect('/padharosaa/desk');
}
