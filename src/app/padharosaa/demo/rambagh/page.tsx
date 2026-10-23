import type { CSSProperties, ReactNode } from 'react';
import type { Metadata } from 'next';
import { buildTheme, themeVars } from '@/lib/padharosaa/theme';

export const metadata: Metadata = { title: 'Padharosaa demo: Rambagh Hotel, Jaipur', robots: { index: false, follow: false } };

// A sample walk-through of Padharosaa for a Jaipur palace hotel. Every phone number, password, time and menu item below is SAMPLE
// content for the demo; nothing here is read from a database and nothing is official hotel information.
const BRAND = '#a8493c';
const map = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

const SERVICES = [
  ['Housekeeping', 'Towels, cleaning, pillows, toiletries'], ['Wake-up call', 'Pick a time, we call you'], ['Cab', 'Airport, sightseeing, local'],
  ['Late check-out', 'Ask, reception confirms'], ['Table reservation', 'Dinner, high tea, bar'], ['Help / problem', 'AC, Wi-Fi, TV, water, noise'],
] as const;

const CHIPS = ['Veg', 'Jain', 'Shakes', 'Starters', 'Paneer', 'Pasta', 'Rajasthani thali', 'Desserts'];
const DISHES = [
  ['Laal maas', 'Spicy Mathania chilli lamb curry', 'Non-veg'], ['Gatte ki sabzi', 'Gram-flour dumplings in yoghurt gravy', 'Veg'],
  ['Paneer lababdar', 'Cottage cheese, tomato-cashew gravy', 'Veg'], ['Penne arrabbiata', 'Chilli-tomato pasta, parmesan', 'Veg'], ['Thandai shake', 'Almond, saffron, cardamom', 'Veg'],
] as const;

const GUIDE = [
  ['Amer Fort', 'Hilltop fort of red sandstone and marble. Go early, before the crowds and the heat.', 'Best 8:00 to 10:00 am', 'Amer Fort Jaipur'],
  ['Hawa Mahal', 'The pink "Palace of Winds". Best photographed from the cafe across the road.', 'Best at sunrise', 'Hawa Mahal Jaipur'],
  ['City Palace', 'Royal residence with museums, courtyards and textile galleries.', 'Allow 2 hours', 'City Palace Jaipur'],
  ['Jantar Mantar', 'Eighteenth-century stone astronomical instruments, a UNESCO site.', 'Allow 1 hour', 'Jantar Mantar Jaipur'],
  ['Nahargarh Fort at sunset', 'Golden hour over the whole city, with a rooftop restaurant.', 'Best 5:00 to 7:00 pm', 'Nahargarh Fort Jaipur'],
  ['Lassiwala, MI Road', 'Thick, cold lassi in clay cups. A Jaipur habit.', 'Cash only', 'Lassiwala MI Road Jaipur'],
  ['Blue pottery, Bapu Bazaar', 'Hand-painted blue pottery and block-print textiles.', 'Bargain gently', 'Bapu Bazaar Jaipur'],
] as const;

const ROLES = [
  ['Owner', '/owner', 'Everything: team, rooms, QR codes, colours, logo, guide, buffet, WhatsApp alerts.'],
  ['Manager', '/manager', 'The same console, without owner-only settings.'],
  ['Reception', '/reception', 'Front desk and concierge requests: cabs, reservations, late check-out, guest messages.'],
  ['Housekeeping', '/housekeeping', 'Only housekeeping and maintenance requests. No guest phone numbers.'],
  ['Kitchen', '/kitchen', 'Only food orders. Decides Room delivery or Takeaway, and writes a reason when it cannot take an order.'],
  ['Desk board', '/desk', 'The shared live board; each person sees only what their role may act on.'],
] as const;

function Section({ id, title, sub, children }: { id: string; title: string; sub?: string; children: ReactNode }) {
  return (
    <section id={id} className="mx-auto max-w-5xl px-5 py-10">
      <h2 className="text-2xl font-extrabold tracking-tight">{title}</h2>
      {sub && <p className="mt-1 max-w-2xl" style={{ color: 'var(--ink)', opacity: 0.8 }}>{sub}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

const card: CSSProperties = { background: '#fff', color: 'var(--ink)', boxShadow: '0 1px 2px rgba(0,0,0,.08), inset 0 0 0 1px rgba(0,0,0,.06)' };

function Phone({ title, children }: { title: string; children: ReactNode }) {
  return (
    <figure className="mx-auto w-full max-w-[19rem]">
      <div className="overflow-hidden rounded-[2rem] border-[10px] border-stone-900 bg-stone-900 shadow-xl">
        <div className="min-h-[30rem] overflow-hidden rounded-[1.2rem]" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>{children}</div>
      </div>
      <figcaption className="mt-3 text-center text-sm font-semibold">{title}</figcaption>
    </figure>
  );
}

const Pill = ({ children }: { children: ReactNode }) => (
  <span className="inline-block rounded-full px-3 py-1 text-xs font-bold" style={{ background: 'var(--tint)', color: 'var(--on-tint)' }}>{children}</span>
);

export default function RambaghDemo() {
  const style = themeVars(buildTheme(BRAND)) as CSSProperties;
  const hero: CSSProperties = { background: 'linear-gradient(160deg, var(--hero-0), var(--hero-1) 55%, var(--hero-2))', color: 'var(--on-hero)' };
  const btn: CSSProperties = { background: 'var(--button)', color: 'var(--on-button)', boxShadow: 'inset 0 0 0 2px var(--btn-edge)' };
  return (
    <div style={{ ...style, background: 'var(--paper)', color: 'var(--ink)' }} className="min-h-dvh">
      <header style={hero}>
        <div className="mx-auto max-w-5xl px-5 pb-12 pt-10">
          <p className="inline-block rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-widest" style={{ borderColor: 'var(--on-hero-soft)' }}>Demo with sample data</p>
          <h1 className="mt-4 text-4xl font-extrabold leading-tight sm:text-5xl">Rambagh Hotel, Jaipur</h1>
          <p className="mt-3 max-w-2xl text-lg" style={{ color: 'var(--on-hero-soft)' }}>
            A digital concierge in every guest&apos;s phone. Scan the QR in the room, no app to install, and the whole stay is one tap away: food, services, help, the city.
          </p>
          <nav aria-label="Sections" className="mt-6 flex flex-wrap gap-2 text-sm font-semibold">
            {[['hotel', 'The hotel'], ['guest', 'Guest phone'], ['dining', 'Dining'], ['guide', 'Jaipur guide'], ['help', 'Help and tracking'], ['team', 'Staff pages'], ['why', 'Why it pays']].map(([id, label]) => (
              <a key={id} href={`#${id}`} className="inline-flex min-h-11 items-center rounded-full px-4" style={{ background: 'rgba(255,255,255,.16)', color: 'var(--on-hero)' }}>{label}</a>
            ))}
          </nav>
        </div>
      </header>

      <Section id="hotel" title="The hotel" sub="What a guest sees about the property, and what the hotel controls from its own manager page.">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl p-5" style={card}>
            <h3 className="font-extrabold">About</h3>
            <p className="mt-2 text-sm leading-relaxed">A palace hotel in Jaipur, the Pink City of Rajasthan, set in landscaped gardens on Bhawani Singh Road. The building was once a royal residence, and the stay is meant to feel like being a guest of the palace.</p>
            <p className="mt-3 text-sm"><a className="font-semibold underline" href={map('Rambagh Palace Jaipur')} target="_blank" rel="noopener noreferrer">Directions to the entrance</a></p>
          </div>
          <div className="rounded-2xl p-5" style={card}>
            <h3 className="font-extrabold">Stay information <Pill>sample</Pill></h3>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="font-semibold">Check-in</dt><dd>2:00 pm</dd>
              <dt className="font-semibold">Check-out</dt><dd>12:00 noon</dd>
              <dt className="font-semibold">Breakfast</dt><dd>7:00 to 10:30 am, Verandah</dd>
              <dt className="font-semibold">Wi-Fi</dt><dd>Rambagh-Guest, password shown in the app after login</dd>
              <dt className="font-semibold">Reception</dt><dd>Dial 0 from the room, or tap Call reception</dd>
            </dl>
          </div>
        </div>
        <ul className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
          {['Hotel name, logo and colour set by the manager', 'Google and TripAdvisor review links, equal and ungated', 'Instagram link and the always-visible Call reception button'].map((t) => (
            <li key={t} className="rounded-xl p-4" style={card}>{t}</li>
          ))}
        </ul>
      </Section>

      <Section id="guest" title="What the guest sees" sub="Scan, enter name, mobile and room number, and the phone becomes the concierge. Works in English and Hindi.">
        <div className="grid gap-8 md:grid-cols-3">
          <Phone title="1. Sign in (20 seconds)">
            <div style={hero} className="p-5"><h3 className="text-2xl font-extrabold">Welcome</h3><p className="mt-1 text-sm" style={{ color: 'var(--on-hero-soft)' }}>Tell us who you are. It takes 20 seconds.</p></div>
            <div className="space-y-3 p-5 text-sm">
              {['Your name', 'Mobile number', 'Room number'].map((l) => (<div key={l}><p className="font-semibold">{l}</p><div className="mt-1 h-10 rounded-xl bg-white" style={{ boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.15)' }} /></div>))}
              <p className="text-xs">☐ I agree to be contacted about my requests during my stay.</p>
              <div className="rounded-2xl py-3 text-center font-bold" style={btn}>Enter</div>
            </div>
          </Phone>
          <Phone title="2. Home">
            <div style={hero} className="p-5"><p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--on-hero-soft)' }}>Rambagh Hotel</p><h3 className="text-xl font-extrabold">Namaste, Aarav</h3><p className="text-sm" style={{ color: 'var(--on-hero-soft)' }}>Room 204 · What would you like?</p></div>
            <div className="grid grid-cols-2 gap-2 p-4 text-sm font-semibold">
              {['Dining', 'Services', 'Stay & Wi-Fi', "Today's buffet", 'Jaipur guide', 'Help / problem'].map((t) => (<div key={t} className="rounded-2xl p-3" style={{ background: 'var(--tint)', color: 'var(--on-tint)' }}>{t}</div>))}
            </div>
            <div className="px-4"><div className="rounded-2xl py-3 text-center font-bold" style={btn}>Call reception</div></div>
            <p className="mt-4 text-center text-xs opacity-70">Powered by Taprizz</p>
          </Phone>
          <Phone title="3. Services">
            <div className="space-y-2 p-4 text-sm">
              {SERVICES.map(([t, d]) => (<div key={t} className="rounded-2xl p-3" style={card}><p className="font-bold">{t}</p><p className="opacity-75">{d}</p></div>))}
            </div>
          </Phone>
        </div>
      </Section>

      <Section id="dining" title="Dining, from craving to room" sub="The guest picks what they feel like, sees the real menu already filtered, orders, and the kitchen chooses delivery or takeaway.">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl p-5" style={card}>
            <h3 className="font-extrabold">What do you feel like?</h3>
            <p className="mt-1 text-sm opacity-75">Pick one or more, then see the menu.</p>
            <div className="mt-3 flex flex-wrap gap-2">{CHIPS.map((c, i) => (<span key={c} className="rounded-full px-3 py-2 text-sm font-semibold" style={i % 3 === 0 ? { background: 'var(--button)', color: 'var(--on-button)' } : { background: 'var(--tint)', color: 'var(--on-tint)' }}>{c}</span>))}</div>
            <p className="mt-4 text-sm font-semibold">Food type</p>
            <div className="mt-2 flex gap-2"><Pill>Veg</Pill><Pill>Jain</Pill></div>
          </div>
          <div className="rounded-2xl p-5" style={card}>
            <h3 className="font-extrabold">Menu <Pill>sample dishes</Pill></h3>
            <ul className="mt-2 divide-y divide-stone-200 text-sm">{DISHES.map(([n, d, t]) => (<li key={n} className="flex items-start justify-between gap-3 py-2"><span><strong>{n}</strong><br /><span className="opacity-75">{d}</span></span><span className="shrink-0 text-xs font-bold">{t}</span></li>))}</ul>
            <p className="mt-3 text-sm"><strong>Kitchen decides:</strong> Room delivery or Takeaway. If it cannot take an order, the guest gets a written reason.</p>
          </div>
        </div>
        <div className="mt-4 rounded-2xl p-5" style={card}>
          <h3 className="font-extrabold">Today&apos;s buffet <Pill>sample</Pill></h3>
          <p className="mt-1 text-sm">Rajasthani dinner buffet · 7:30 to 10:30 pm · Suryamahal. Live bar, dal baati churma, ker sangri, kulfi counter. The manager sets it a day ahead; the guest sees it on the home screen.</p>
        </div>
      </Section>

      <Section id="guide" title="Jaipur guide" sub="Chosen by the hotel's own team. Every place has a short description, the best time, and one-tap Google Maps directions. Guests add places to a day plan and send it to the concierge.">
        <div className="grid gap-4 sm:grid-cols-2">
          {GUIDE.map(([name, desc, when, q]) => (
            <article key={name} className="rounded-2xl p-5" style={card}>
              <h3 className="font-extrabold">{name}</h3>
              <p className="mt-1 text-sm leading-relaxed">{desc}</p>
              <p className="mt-2 flex flex-wrap items-center gap-2 text-sm"><Pill>{when}</Pill>
                <a className="inline-flex min-h-11 items-center rounded-full px-4 font-bold" style={btn} href={map(q)} target="_blank" rel="noopener noreferrer">Directions</a></p>
            </article>
          ))}
        </div>
        <p className="mt-4 text-sm">AI and map data only ever create <strong>drafts</strong>. Nothing reaches a guest until the manager reads and publishes it, and if the AI is unavailable the manager writes entries by hand.</p>
      </Section>

      <Section id="help" title="Help and live tracking" sub="Something wrong? The guest taps what applies, and the right team is alerted at once.">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl p-5" style={card}>
            <h3 className="font-extrabold">Call for problems</h3>
            <p className="mt-1 text-sm opacity-75">Tap all that apply.</p>
            <div className="mt-3 flex flex-wrap gap-2">{['AC or electrical', 'WiFi not working', 'Water not coming', 'TV not working', 'Towel or bedsheet', 'Cleanliness', 'Noise'].map((c, i) => (<span key={c} className="rounded-full px-3 py-2 text-sm font-semibold" style={i < 2 ? { background: 'var(--button)', color: 'var(--on-button)' } : { background: 'var(--tint)', color: 'var(--on-tint)' }}>{c}</span>))}</div>
            <p className="mt-3 text-sm">☑ This is urgent</p>
          </div>
          <div className="rounded-2xl p-5" style={card}>
            <h3 className="font-extrabold">Tracking</h3>
            <ol className="mt-3 space-y-3 text-sm">
              <li><strong>Sent</strong> · 9:42 pm. Your request was sent to the team.</li>
              <li><strong>Accepted</strong> · 9:44 pm. Accepted by Maintenance.</li>
              <li><strong>Done</strong> · 9:58 pm. Is everything okay now? <span className="font-semibold">Yes, all good / Not yet</span></li>
            </ol>
            <p className="mt-3 text-sm">Then one tap: Great, Okay or Not good. A happy guest is offered Google or TripAdvisor, equally. An unhappy one goes to the manager first, never trapped and never gated.</p>
          </div>
        </div>
      </Section>

      <Section id="team" title="The staff side" sub="One sign-in at padharosaa.taprizz.in/login, and each person lands on their own page. Housekeeping never sees food orders; the kitchen never sees guest phone numbers.">
        <div className="grid gap-3 sm:grid-cols-2">
          {ROLES.map(([name, path, text]) => (
            <div key={name} className="rounded-2xl p-5" style={card}><h3 className="font-extrabold">{name} <code className="ml-1 rounded bg-stone-100 px-2 py-0.5 text-xs font-semibold">{path}</code></h3><p className="mt-1 text-sm">{text}</p></div>
          ))}
        </div>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm">
          <li>Alarm sound and a flashing board for new and urgent requests; each person can mute their own alerts.</li>
          <li>Problems go to reception, and by WhatsApp to the head of the right department.</li>
          <li>Every request keeps a history: who accepted, who finished, and when.</li>
          <li>Staff sign in with email, password and an authenticator code. Staff lists can be imported from a CSV.</li>
        </ul>
      </Section>

      <Section id="why" title="Why a hotel wants this">
        <div className="grid gap-3 sm:grid-cols-3">
          {[['Fewer calls to reception', 'Towels, wake-up, cab and food requests arrive as clear tasks instead of phone calls.'], ['Problems caught early', 'A guest tells the hotel first, so fewer complaints turn into public reviews.'], ['More from every stay', 'In-room dining, the buffet and the concierge are in front of the guest at the moment of need.'], ['Better reviews', 'Happy guests are asked for a Google or TripAdvisor review at the right moment.'], ['Private by design', 'Phone numbers are stored encrypted, sessions end at check-out, and nobody sees another team’s data.'], ['Your brand, not ours', 'Hotel logo and colours throughout, with a small Powered by Taprizz line.']].map(([t, d]) => (
            <div key={t} className="rounded-2xl p-5" style={card}><h3 className="font-extrabold">{t}</h3><p className="mt-1 text-sm">{d}</p></div>
          ))}
        </div>
        <div className="mt-8 rounded-3xl p-6 text-center" style={hero}>
          <h3 className="text-2xl font-extrabold">Want this for your hotel?</h3>
          <p className="mt-1" style={{ color: 'var(--on-hero-soft)' }}>Ready in a day: your logo, your colours, one QR sticker per room.</p>
          <a className="mt-4 inline-flex min-h-12 items-center rounded-full px-6 font-bold" style={btn} href="https://instagram.com/taprizz.in" target="_blank" rel="noopener noreferrer">Talk to Taprizz · @taprizz.in</a>
        </div>
        <p className="mt-6 text-center text-xs opacity-70">Demo for illustration. Names, times, menus, phone numbers and passwords are sample content, and the page is not an official page of any hotel.</p>
      </Section>
    </div>
  );
}
