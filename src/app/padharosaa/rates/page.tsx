import { redirect } from 'next/navigation';

// Prices now live inside Rooms (the Prices tab). Old bookmarks land there.
export default function Page() {
  redirect('/padharosaa/rooms?tab=prices');
}
