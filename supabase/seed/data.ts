export type Diet = 'veg' | 'nonveg' | 'egg' | 'jain';
export interface SeedItem {
  en: string; descEn: string;
  rupees: number; diet: Diet; spice?: 0 | 1 | 2 | 3; best?: boolean; chef?: boolean; soldOut?: boolean;
}
export interface SeedCategory { en: string; items: SeedItem[] }
export interface SeedRestaurant {
  slug: string; name: string; accent: string; reviewUrl: string; tables: number; categories: SeedCategory[];
}

const v = (en: string, descEn: string, rupees: number, extra: Partial<SeedItem> = {}): SeedItem =>
  ({ en, descEn, rupees, diet: 'veg', ...extra });
const n = (en: string, descEn: string, rupees: number, extra: Partial<SeedItem> = {}): SeedItem =>
  ({ en, descEn, rupees, diet: 'nonveg', ...extra });

export const SPICE_GARDEN: SeedRestaurant = {
  slug: 'spice-garden',
  name: 'Spice Garden',
  accent: 'tomato',
  reviewUrl: 'https://search.google.com/local/writereview?placeid=DEMO_PLACE_ID_SPICE_GARDEN',
  tables: 12,
  categories: [
    { en: 'Starters', items: [
      v('Paneer Tikka', 'Cottage cheese marinated in spiced yoghurt, charred in the tandoor.', 280, { spice: 2, best: true }),
      v('Hara Bhara Kebab', 'Spinach, peas and potato patties, lightly pan-fried.', 240, { spice: 1 }),
      v('Veg Manchurian (Dry)', 'Crisp vegetable dumplings tossed in a spicy garlic sauce.', 220, { spice: 2 }),
      n('Chicken Tikka', 'Boneless chicken marinated overnight and grilled over charcoal.', 320, { spice: 2, best: true }),
      n('Tandoori Chicken (Half)', 'Classic bone-in chicken, smoky and juicy.', 360, { spice: 3 }),
      n('Fish Amritsari', 'Crisp gram-flour battered fish with ajwain and lemon.', 340, { spice: 2, chef: true }),
    ] },
    { en: 'Main Course (Veg)', items: [
      v('Paneer Butter Masala', 'Soft paneer in a rich, creamy tomato gravy.', 290, { spice: 1, best: true }),
      v('Dal Makhani', 'Black lentils slow-cooked overnight with butter and cream.', 240, { spice: 1, chef: true }),
      v('Kadai Paneer', 'Paneer with capsicum and freshly ground kadai masala.', 280, { spice: 2 }),
      v('Palak Paneer', 'Paneer cubes in a smooth spinach gravy.', 270, { spice: 1 }),
      v('Mix Veg', 'Seasonal vegetables in a home-style masala.', 220, { spice: 1 }),
      v('Chana Masala', 'Chickpeas simmered with tangy spices.', 210, { spice: 2, soldOut: true }),
      { ...v('Jain Dal Tadka', 'Yellow dal tempered with cumin and ghee. No onion, no garlic.', 200, { spice: 1 }), diet: 'jain' },
      { ...v('Jain Mix Veg', 'Vegetables in a mild tomato gravy. No onion, no garlic, no root vegetables.', 230), diet: 'jain' },
    ] },
    { en: 'Main Course (Non-veg)', items: [
      n('Butter Chicken', 'Tandoori chicken in a velvety tomato-butter gravy.', 340, { spice: 1, best: true }),
      n('Chicken Curry', 'Home-style chicken curry with whole spices.', 300, { spice: 2 }),
      n('Mutton Rogan Josh', 'Kashmiri-style mutton braised with fennel and dry ginger.', 420, { spice: 3, chef: true }),
      { ...n('Egg Curry', 'Boiled eggs in an onion-tomato masala.', 220, { spice: 2 }), diet: 'egg' },
    ] },
    { en: 'Breads & Rice', items: [
      v('Butter Naan', 'Soft tandoor-baked bread brushed with butter.', 60),
      v('Garlic Naan', 'Naan topped with garlic and coriander.', 70),
      v('Tandoori Roti', 'Whole-wheat bread from the tandoor.', 35),
      v('Laccha Paratha', 'Flaky layered whole-wheat paratha.', 65),
      v('Jeera Rice', 'Basmati rice tempered with cumin.', 160),
      v('Veg Biryani', 'Fragrant basmati layered with vegetables, served with raita.', 260, { spice: 2, best: true }),
      n('Chicken Biryani', 'Dum-cooked basmati with tender chicken, served with raita.', 320, { spice: 2, chef: true }),
    ] },
    { en: 'Desserts', items: [
      v('Gulab Jamun (2 pcs)', 'Warm milk dumplings in cardamom syrup.', 80),
      v('Rasmalai (2 pcs)', 'Soft cottage cheese discs in chilled saffron milk.', 120),
      v('Gajar Halwa', 'Slow-cooked carrot pudding with nuts.', 130, { best: true }),
      v('Kulfi Falooda', 'Pistachio kulfi with falooda and rose syrup.', 140),
    ] },
    { en: 'Beverages', items: [
      v('Sweet Lassi', 'Thick chilled yoghurt drink.', 90, { best: true }),
      v('Masala Chaas', 'Spiced buttermilk with roasted cumin.', 60),
      v('Fresh Lime Soda', 'Sweet, salted or mixed.', 70),
      v('Masala Chai', 'Strong tea with ginger and cardamom.', 40),
      v('Cold Drink (300 ml)', 'Assorted soft drinks.', 40),
    ] },
  ],
};

export const CAFE_AROMA: SeedRestaurant = {
  slug: 'cafe-aroma',
  name: 'Cafe Aroma',
  accent: 'teal',
  reviewUrl: 'https://search.google.com/local/writereview?placeid=DEMO_PLACE_ID_CAFE_AROMA',
  tables: 8,
  categories: [
    { en: 'Coffee', items: [
      v('Cappuccino', 'Espresso with silky steamed milk and foam.', 180),
      v('Café Latte', 'Smooth and milky, lightly sweet.', 190),
      v('Cold Coffee', 'Blended iced coffee with a scoop of ice cream.', 200, { best: true }),
      v('Filter Coffee', 'South Indian decoction coffee with frothy milk.', 120, { chef: true }),
      v('Espresso', 'A short, strong shot.', 120),
    ] },
    { en: 'Tea', items: [
      v('Masala Chai', 'Ginger, cardamom and tea, simmered in milk.', 80, { best: true }),
      v('Ginger Honey Tea', 'Warming and soothing, no milk.', 100),
      v('Green Tea', 'Light and refreshing.', 100),
      v('Iced Lemon Tea', 'Chilled black tea with lemon and mint.', 140),
    ] },
    { en: 'Snacks', items: [
      v('Veg Sandwich', 'Fresh vegetables and mint chutney on toasted bread.', 150),
      v('Grilled Cheese Sandwich', 'Three cheeses, golden and melty.', 180, { best: true }),
      n('Chicken Club Sandwich', 'Grilled chicken, egg-free mayo and salad in a triple-decker.', 240),
      v('Aloo Tikki Burger', 'Crisp potato patty with onions and sauces.', 160),
      v('Peri Peri Fries', 'Crinkle-cut fries tossed in peri peri seasoning.', 150, { spice: 2 }),
      v('Veg Maggi', 'Masala noodles with vegetables.', 120, { best: true, spice: 1 }),
      v('Paneer Wrap', 'Tandoori paneer, onions and mint mayo in a whole-wheat wrap.', 200, { spice: 1 }),
    ] },
    { en: 'Bakery', items: [
      v('Chocolate Brownie', 'Fudgy brownie with a walnut crunch.', 140, { chef: true }),
      v('Blueberry Muffin', 'Soft muffin bursting with blueberries.', 100),
      v('Butter Croissant', 'Flaky, buttery and baked fresh daily.', 110),
      v('Red Velvet Slice', 'Cream cheese frosting on moist red velvet cake.', 160, { soldOut: true }),
      { ...v('Egg Puff', 'Flaky pastry around a spiced boiled egg.', 80), diet: 'egg' },
    ] },
  ],
};

export const DEMO_RESTAURANTS = [SPICE_GARDEN, CAFE_AROMA];
export const ROLES = ['owner', 'manager', 'waiter', 'kitchen'] as const;
