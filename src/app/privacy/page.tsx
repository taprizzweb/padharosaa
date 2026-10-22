import type { Metadata } from 'next';
import { t } from '@/lib/i18n';

export const metadata: Metadata = { title: 'Privacy notice' };

const sections: [string, string][] = [
  ['What we collect from guests', 'Nothing about who you are. We do not ask for your name, phone number, email or location, and there is no account or login. We keep what you order, which table it was for, and when.'],
  ['Cookies and your phone', 'After you place an order or call the waiter, we save one small cookie so your phone can show your table’s live order status. It lasts 12 hours and contains no personal details. Your cart is also remembered on your phone only, so it survives a page refresh.'],
  ['Your IP address', 'To stop abuse, such as fake orders, we turn your internet address into a scrambled code that cannot be turned back into the address. The code is deleted within a day. We never store or share the address itself.'],
  ['Your location', 'Some cafes only take orders from guests who are at the cafe. In that case your phone asks to share its location when you place an order. We compare it with the cafe’s position once, to see whether you are nearby, and we do not save it. If you say no, you can still read the menu and ask a team member to take your order.'],
  ['Menu statistics', 'To help the restaurant see which dishes people look at, the menu counts simple actions such as opening the menu, opening a dish or tapping a contact button. Each browser tab gets a random code that is forgotten when you close the tab. No name, phone number, address or IP address is stored with these counts, and they are deleted after 180 days. If your phone is set to “Do Not Track”, nothing is counted.'],
  ['Google reviews', 'The “Rate us on Google” button opens the restaurant’s Google page, which has its own privacy rules. We only count that the button was pressed; we do not know who pressed it.'],
  ['Staff', 'For restaurant staff accounts we keep an email address and a display name, only so they can log in and so the restaurant can see who did what.'],
  ['Sharing and where data is kept', 'We do not sell data, show ads or use third-party tracking. Data is stored with our hosting provider in India (Mumbai) and is visible only to the restaurant you ordered from.'],
  ['Your choices', 'Because we do not hold personal details about guests, there is usually nothing to look up or delete. If you have a question, please ask the restaurant team.'],
];

export default function Privacy() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <h1 className="text-3xl font-extrabold">{t('privacy.title')}</h1>
      <div className="mt-6 space-y-6">
        {sections.map(([h, p]) => (
          <section key={h}>
            <h2 className="text-lg font-bold">{h}</h2>
            <p className="mt-1 text-stone-800">{p}</p>
          </section>
        ))}
      </div>
    </main>
  );
}
