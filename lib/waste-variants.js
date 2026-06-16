/** Retail prices for whole-sandwich waste (dropdown). */
export const SANDWICH_OPTIONS = [
  { name: "Classic Roast Beef", price: 4.59 },
  { name: "Double Roast Beef", price: 5.99 },
  { name: "Half Pound Roast Beef", price: 7.19 },
  { name: "Classic Beef n Cheddar", price: 5.49 },
  { name: "Double Beef n Cheddar", price: 6.99 },
  { name: "Half Pound Beef n Cheddar", price: 8.19 },
  { name: "Classic Bacon Beef n Cheddar", price: 6.19 },
  { name: "Gyro (Beef/Turkey/Greek)", price: 5.99 },
  { name: "Reuben (CB/Turkey)", price: 7.49 },
  { name: "Double Reuben", price: 9.29 },
  { name: "French Dip & Swiss", price: 6.49 },
  { name: "Half Pound French Dip", price: 8.99 },
  { name: "MF Turkey & Swiss", price: 7.99 },
  { name: "MF Turkey Bacon Ranch", price: 8.19 },
  { name: "Crispy Chicken Wrap", price: 7.99 },
  { name: "Smokehouse Brisket", price: 7.99 },
  { name: "Deluxe Burger", price: 6.99 },
  { name: "Cheesy Big Bacon Burger", price: 7.99 },
  { name: "Sausage Biscuit", price: 2.49 },
  { name: "Bacon Biscuit", price: 2.49 },
  { name: "Croissant Sandwich", price: 3.29 },
];

export function itemDisplayName(item) {
  return item.item_name ?? item.name ?? "Item";
}

export function isMultiRowSandwichItem(item) {
  return Boolean(item.is_dropdown);
}

export function createSandwichRow() {
  return {
    rowId: crypto.randomUUID(),
    optionIdx: -1,
    qty: "",
  };
}

export function sandwichRowKey(item) {
  return item.id;
}
