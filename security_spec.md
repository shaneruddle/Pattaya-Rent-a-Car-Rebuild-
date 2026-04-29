# Security Specification - Pattaya Rent a Car

## Data Invariants
1. Cars are publicly viewable but only staff can modify them.
2. Bookings can be created by anyone (public) but only staff can view and manage all bookings.
3. Users can only read and write their own user profile data, unless they are an admin.
4. Financial transactions and accounts are only accessible to staff.
5. Mail documents are publicly creatable to trigger notifications but read-restricted to staff.
6. System logs can be created by anyone (to log public actions) but read-restricted to staff.
7. Pricing and FAQs are publicly readable but staff-writable.
8. The root admin (info@pattayarentacar.com) has full access to everything.

## The Dirty Dozen Payloads (Rejection Targets)
1. **Identity Spoofing**: Attempt to create a user profile for a different UID.
2. **Privilege Escalation**: Attempt to set `role: 'admin'` on a user profile.
3. **Ghost Field Injection**: Add `isVerified: true` to a car document update.
4. **Data Poisoning**: Inject a 1MB string into a car's `plateNumber`.
5. **Relational Bypass**: Create a booking for a car that doesn't exist.
6. **Finance Leak**: Publicly query the `transactions` collection.
7. **PII Scraping**: Publicly query the `customers` collection.
8. **Outcome Manipulation**: Change a booking status from `Paid` to `Pending` after completion.
9. **Timestamp Spoofing**: Set a future `createdAt` date on a booking.
10. **Admin Locked**: Try to update a system_config document as a customer.
11. **Shadow Update**: Update only the `pricePerDay` of a car without providing other required fields.
12. **Recursive Cost Attack**: Query a complex collection with many `get()` calls in rules (optimized out).
