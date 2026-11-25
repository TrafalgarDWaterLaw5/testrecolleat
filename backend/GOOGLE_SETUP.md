# Optional Google restaurant matching — Build 4.3

1. Create a Google Cloud project and configure billing. Enable Maps JavaScript API and Places API (New).
2. Create a browser API key, restrict it to your actual HTTPS hosting referrers and the APIs above. Set quotas and billing alerts (alerts are not hard spending caps).
3. Put the restricted browser key in places-config.js. Never use an unrestricted server key.
4. Deploy the static app. In the full restaurant editor, enter your own restaurant name, search by name and town, select the Google result and save. The place ID is stored locally; Google names and addresses are not copied into the journal. No journal sync, location permission or background requests.
5. Verify live results, attribution, key restrictions, error handling, and current Maps Platform terms before beta. Search can incur charges. Quick Log remains manual; use Save & review to match afterwards. No existing restaurant records are bulk matched.

Docs: https://developers.google.com/maps/documentation/javascript/place-search ; https://developers.google.com/maps/documentation/javascript/policies
