# Mark buttons finish saving independently of refresh

SLN-868: Rare, Anathema and Favourite now track their own save request instead of React’s page-refresh transition. Each keeps a synchronous in-flight guard, releases busy when its request settles, and preserves or restores its shown value on success or refusal. Refresh can continue without keeping the control locked.

Regression tests suspend an actual React refresh transition: all three controls become usable after the save even while the old view remains. A repeated press while saving issues one request; refusals clear busy and restore the prior state. These tests fail on the previous implementation. No schema or catalogue changes.
