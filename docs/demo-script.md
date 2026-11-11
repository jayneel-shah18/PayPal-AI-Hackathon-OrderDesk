# Demo video script

One story, 2:45 total, recorded on the live URL. No copyrighted music and no real brand logos. Record at 1080p with the browser zoomed to 125%, one take per row.

| Time | Screen | Voiceover |
| --- | --- | --- |
| 0:00 to 0:20 | Phone with a text message order, then the empty OrderDesk New order page | "Small distributors, like the companies that supply restaurants and cafes, get orders like this every day: half English, half Spanish, no SKUs. Someone retypes each one into an invoice, then chases payment." |
| 0:20 to 0:55 | Click **Spanish/English mix**, then **Read order**. The activity panel shows `search_catalog` calls and the review screen fills | "OrderDesk reads it, matches servilletas to napkins and dish soap to the right jug, and prices every line from our catalog." |
| 0:55 to 1:25 | Paste the **Ambiguous** order. Amber flags appear. Pick the cup size in one click and enter a quantity | "When an order is unclear, it doesn't guess. It flags the line and tells me why. I fix it in one click." |
| 1:25 to 2:00 | Click **Approve and send invoice**. The panel shows `create_invoice`, then `send_invoice`, through the PayPal Agent Toolkit. The payer link appears | "Nothing goes out until I approve. Then the agent uses PayPal's Agent Toolkit to create and send a real sandbox invoice." |
| 2:00 to 2:25 | Open the payer link, pay as the sandbox buyer, cut back to the Orders page as the row flips to Paid | "The customer pays through PayPal, the webhook comes back, and the order is marked paid. No chasing." |
| 2:25 to 2:45 | Quick flash of the handwritten photo sample and the QR code, then the repo and live URL | "It also reads handwritten orders and makes a QR code for counter payments. Code and live demo are linked below." |

Before recording: open the live URL once so the free Render service is awake, and run `npm run db:seed` against the production database so the Orders page is not empty.
