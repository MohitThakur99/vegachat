/** How far one of my own messages has got. Derived from the other members' watermarks. */
export const Receipt = Object.freeze({
  SENT: 'sent',
  DELIVERED: 'delivered',
  READ: 'read',
});
