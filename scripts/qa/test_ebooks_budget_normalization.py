"""Bounded offline budget regressions. No AWS, Keychain, FIFO, subprocess or app."""
import copy
from decimal import Decimal, localcontext
import importlib.util
import json
import math
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('budget_contract', ROOT / 'scripts/aws/ebooks-cdn.py')
cdn = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cdn)
FIXTURE = json.loads((ROOT / 'scripts/qa/fixtures/ebooks-budget-response.json').read_text())
ACCOUNT = '111122223333'
ADMIN = 'arn:aws:iam::' + ACCOUNT + ':role/OwnerAdmin'
EMAIL = 'recipient@example.invalid'


class PrivateSecrets:
    def get(self, service, account):
        assert (service, account) == (cdn.EMAIL_SERVICE, ACCOUNT)
        return EMAIL.encode()


class ReadOnlyAws:
    def __init__(self):
        self.account, self.admin, self.allow_writes = ACCOUNT, ADMIN, False
        self.budget = copy.deepcopy(FIXTURE['budget'])
        self.notes = copy.deepcopy(FIXTURE['notifications'])
        self.subscribers = [{'SubscriptionType': 'EMAIL', 'Address': EMAIL}]
        self.list_token, self.subscriber_token, self.lookup_missing = False, False, False
        self.calls = []

    def call(self, service, operation, arguments=(), document=None, missing=None):
        assert service == 'budgets'
        self.calls.append((operation, copy.deepcopy(document)))
        if operation == 'describe-budget':
            return {'Budget': copy.deepcopy(self.budget)} if self.budget else None
        if operation == 'describe-notifications-for-budget':
            return {'Notifications': copy.deepcopy(self.notes), **({'NextToken': 'unresolved'} if self.list_token else {})}
        if operation == 'describe-subscribers-for-notification':
            assert document['Notification']['ThresholdType'] in ('PERCENTAGE', 'ABSOLUTE_VALUE')
            return {'Subscribers': [] if self.lookup_missing else copy.deepcopy(self.subscribers),
                    **({'NextToken': 'unresolved'} if self.subscriber_token else {})}
        raise AssertionError('No mutations are permitted in this fixture')


class BudgetNormalizationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir='/private/tmp')
        self.folder = Path(self.temporary.name)
        self.aws = ReadOnlyAws()
        self.control = cdn.Control(self.aws, self.folder / 'state', PrivateSecrets())
        self.control.state['budget_start'] = 1790812800

    def tearDown(self):
        self.temporary.cleanup()

    def test_exact_decimal_high_precision_without_rounding(self):
        for value in ('5', '5.0', '005.000'):
            self.assertEqual('5', cdn.budget_amount(value))
        precise = '5.000000000000000000000000000000000000000000000000001'
        with localcontext() as context:
            context.prec = 3
            self.assertEqual(precise, cdn.budget_amount(precise))
        self.assertNotEqual(cdn.budget_amount('5'), cdn.budget_amount(precise))

    def test_malformed_or_schema_invalid_amounts_refuse(self):
        for value in (True, 5, 5.0, None, 'NaN', 'Infinity', '5e0', '-5', '+5', ' 5', '5.', '', '1' * 257):
            with self.subTest(value=value), self.assertRaises(cdn.Refusal):
                cdn.budget_amount(value)

    def test_aware_epoch_offset_and_fractional_instants_are_exact(self):
        expected = '2026-10-01T00:00:00Z'
        for value in (1790812800, 1790812800.0, Decimal('1790812800.000'), expected,
                      '2026-10-01T02:00:00+02:00', '2026-09-30T19:00:00-05:00'):
            self.assertEqual(expected, cdn.budget_time(value))
        fractional = '2026-10-01T00:00:00.000000000000000000000001Z'
        self.assertEqual(fractional, cdn.budget_time(fractional))
        self.assertEqual(fractional, cdn.budget_time(Decimal('1790812800.000000000000000000000001')))
        self.assertNotEqual(expected, cdn.budget_time(fractional))
        self.assertNotEqual(expected, cdn.budget_time(1790812801))

    def test_invalid_naive_nonfinite_or_unbounded_dates_refuse(self):
        for value in (True, None, '2026-10-01', '2026-10-01T00:00:00', '1790812800',
                      '2026-10-01T00:00:00+02:60', '2026-02-30T00:00:00Z', float('nan'),
                      float('inf'), Decimal('1E-1000000')):
            with self.subTest(value=str(value)), self.assertRaises(cdn.Refusal):
                cdn.budget_time(value)

    def test_response_normalization_is_idempotent_and_preserves_raw_input(self):
        raw = copy.deepcopy(self.aws.budget)
        desired = self.control.documents()['budget.json']
        normalized = cdn.budget_config(raw)
        self.assertTrue(cdn.budget_matches(desired, raw))
        self.assertEqual(normalized, cdn.budget_config(normalized))
        self.assertEqual(self.aws.budget, raw)
        self.assertEqual('5.0', raw['BudgetLimit']['Amount'])

    def test_health_is_separate_and_raw_diagnostics_are_retained(self):
        original = copy.deepcopy(self.aws.budget)
        config = cdn.budget_config(original)
        self.aws.budget['HealthStatus']['LastUpdatedTime'] = '2026-10-11T00:00:00Z'
        self.assertEqual(config, cdn.budget_config(self.aws.budget))
        self.aws.budget['HealthStatus']['Status'] = 'UNHEALTHY'
        self.assertEqual(config, cdn.budget_config(self.aws.budget))
        self.assertFalse(cdn.budget_health(self.aws.budget)['accepted'])
        self.assertEqual(self.aws.budget['HealthStatus'], cdn.budget_health(self.aws.budget)['raw'])
        with self.assertRaises(cdn.Refusal):
            self.control.verify_budget()
        self.aws.budget.pop('HealthStatus')
        with self.assertRaises(cdn.Refusal):
            self.control.verify_budget()
        self.aws.budget['HealthStatus'] = {'Status': 'UNKNOWN'}
        with self.assertRaises(cdn.Refusal):
            cdn.budget_config(self.aws.budget)

    def test_every_nonreporting_budget_change_remains_drift(self):
        desired = self.control.documents()['budget.json']
        changes = [('CostFilters', {'Service': ['S3']}), ('FilterExpression', {'And': []}),
                   ('Metrics', ['BlendedCost']), ('AutoAdjustData', {'AutoAdjustType': 'FORECAST'}),
                   ('PlannedBudgetLimits', {}), ('BillingViewArn', 'foreign'), ('UnknownField', True),
                   ('TimeUnit', 'DAILY'), ('BudgetType', 'USAGE'), ('BudgetName', 'other')]
        for field, value in changes:
            raw = {**copy.deepcopy(self.aws.budget), field: value}
            with self.subTest(field=field):
                self.assertFalse(cdn.budget_matches(desired, raw))
        for field in self.aws.budget['CostTypes']:
            raw = copy.deepcopy(self.aws.budget)
            raw['CostTypes'][field] = not raw['CostTypes'][field]
            self.assertFalse(cdn.budget_matches(desired, raw))
        raw = copy.deepcopy(self.aws.budget)
        raw['CostTypes']['IncludeTax'] = 1
        with self.assertRaises(cdn.Refusal):
            cdn.budget_matches(desired, raw)

    def test_missing_type_has_no_unconditional_default(self):
        raw = copy.deepcopy(self.aws.notes[0])
        with self.assertRaises(cdn.Refusal):
            cdn.notification_config(raw)
        with self.assertRaises(cdn.Refusal):
            cdn.notification_preimage([{'Notification': raw, 'Subscribers': []}])
        raw['ThresholdType'] = 'ABSOLUTE_VALUE'
        self.assertEqual('ABSOLUTE_VALUE', cdn.notification_config(raw)['ThresholdType'])
        raw['ThresholdType'] = None
        with self.assertRaises(cdn.Refusal):
            cdn.notification_config(raw)

    def test_missing_types_resolve_only_after_all_exact_private_lookups(self):
        before = copy.deepcopy(self.aws.notes)
        public, private = self.control.read_budget()
        self.assertEqual(before, self.aws.notes)
        self.assertEqual(3, len(public['notifications']))
        proofs = public['budget_evidence']['percentage_lookups']
        self.assertTrue(all(x['explicit_percentage_lookup'] and x['single_intended_email_recipient'] for x in proofs))
        self.assertNotIn(EMAIL, json.dumps(public))
        self.assertTrue(all(x['Notification']['ThresholdType'] == 'PERCENTAGE' for x in private))
        self.control.verify_budget()
        self.assertEqual(0, sum(not operation.startswith('describe-') for operation, _ in self.aws.calls))
        self.assertFalse((self.folder / 'state').exists())

    def test_duplicate_unexpected_null_absolute_and_changed_identities_refuse(self):
        original = copy.deepcopy(self.aws.notes)
        variants = [original[:-1], [original[0], original[0], original[2]]]
        for field, value in (('ThresholdType', 'ABSOLUTE_VALUE'), ('ThresholdType', None),
                             ('Threshold', 81), ('Threshold', True), ('ComparisonOperator', 'LESS_THAN'),
                             ('NotificationType', 'OTHER'), ('UnknownField', True)):
            changed = copy.deepcopy(original)
            changed[0][field] = value
            variants.append(changed)
        for notes in variants:
            self.aws.notes = notes
            with self.subTest(notes=notes), self.assertRaises(cdn.Refusal):
                self.control.read_budget()
        self.assertFalse((self.folder / 'state').exists())

    def test_explicit_int_float_duplicate_preimages_refuse_without_collapsing(self):
        note = {**self.aws.notes[0], 'ThresholdType': 'PERCENTAGE', 'Threshold': 100}
        duplicate = {**note, 'Threshold': 100.0}
        entries = [{'Notification': note, 'Subscribers': []},
                   {'Notification': duplicate, 'Subscribers': []}]
        original = copy.deepcopy(entries)
        with self.assertRaisesRegex(cdn.Refusal, 'Duplicate'):
            cdn.notification_preimage(entries)
        self.assertEqual(original, entries)
        self.assertEqual([], self.aws.calls)

    def test_explicit_numeric_duplicates_refuse_before_lookup_and_preserve_state(self):
        for note in self.aws.notes:
            note['ThresholdType'] = 'PERCENTAGE'
        self.aws.notes[0]['Threshold'] = 100
        self.aws.notes.append({**self.aws.notes[0], 'Threshold': 100.0})
        original = copy.deepcopy(self.aws.notes)
        self.control.state['pending'] = ['budget']
        self.control.state['budget_progress'] = {'plan_sha256': 'synthetic-retained', 'steps': [{'confirmed': False}]}
        self.control.persist()
        path = self.folder / 'state/state.json'
        ledger = path.read_bytes()
        with self.assertRaisesRegex(cdn.Refusal, 'Duplicate'):
            self.control.read_budget()
        self.assertEqual(original, self.aws.notes)
        self.assertEqual(ledger, path.read_bytes())
        self.assertTrue(all(operation.startswith('describe-') for operation, _ in self.aws.calls))
        self.assertFalse(any(operation == 'describe-subscribers-for-notification' for operation, _ in self.aws.calls))

    def test_semantic_threshold_identity_sorting_and_single_note_verification(self):
        for note in self.aws.notes:
            note['ThresholdType'] = 'PERCENTAGE'
        first = {**self.aws.notes[0], 'Threshold': 100}
        floating = {**first, 'Threshold': 100.0}
        different = {**first, 'Threshold': math.nextafter(100.0, math.inf)}
        with localcontext() as context:
            context.prec = 3
            self.assertEqual(cdn.notification_identity(first), cdn.notification_identity(floating))
            self.assertNotEqual(cdn.notification_identity(first), cdn.notification_identity(different))
        entries = [{'Notification': note, 'Subscribers': []} for note in self.aws.notes]
        original = copy.deepcopy(entries)
        normalized = cdn.notification_preimage(entries)
        self.assertEqual(original, entries)
        self.assertEqual(normalized, cdn.notification_preimage(list(reversed(entries))))
        self.control.verify_budget()
        self.aws.notes[0]['Threshold'] = different['Threshold']
        with self.assertRaises(cdn.Refusal):
            self.control.verify_budget()
        self.assertFalse((self.folder / 'state').exists())

    def test_fractional_epoch_float_precision_boundary_is_explicit(self):
        exact = Decimal('1790812800.000000000000000000000001')
        parsed_float = float(exact)
        self.assertEqual(1790812800.0, parsed_float)
        self.assertEqual('2026-10-01T00:00:00Z', cdn.budget_time(parsed_float))
        self.assertNotEqual(cdn.budget_time(exact), cdn.budget_time(parsed_float))

    def test_missing_private_proof_and_unresolved_pagination_refuse(self):
        for flag in ('list_token', 'subscriber_token', 'lookup_missing'):
            setattr(self.aws, flag, True)
            with self.subTest(flag=flag), self.assertRaises(cdn.Refusal):
                self.control.read_budget()
            setattr(self.aws, flag, False)
        for subscribers in ([], [{'SubscriptionType': 'EMAIL', 'Address': 'wrong@example.invalid'}],
                            [{'SubscriptionType': 'EMAIL', 'Address': EMAIL}] * 2,
                            [{'SubscriptionType': 'SNS', 'Address': EMAIL}]):
            self.aws.subscribers = subscribers
            with self.subTest(count=len(subscribers)), self.assertRaises(cdn.Refusal):
                self.control.read_budget()
        self.assertFalse((self.folder / 'state').exists())

    def test_wrong_explicit_recipient_with_same_public_preimage_never_completes(self):
        for note in self.aws.notes:
            note['ThresholdType'] = 'PERCENTAGE'
        correct, _ = self.control.read_budget()
        self.aws.subscribers = [{'SubscriptionType': 'EMAIL', 'Address': 'wrong@example.invalid'}]
        wrong, _ = self.control.read_budget()
        self.assertEqual(self.control.budget_preimage(correct), self.control.budget_preimage(wrong))
        self.assertFalse(wrong['budget_evidence']['all_present_recipients_match_intended'])
        self.assertNotIn('wrong@example.invalid', json.dumps(wrong))
        with self.assertRaises(cdn.Refusal):
            self.control.verify_budget()
        self.assertFalse((self.folder / 'state').exists())

    def test_historical_preimages_normalize_on_copies_without_digest_rewrite(self):
        public, _ = self.control.read_budget()
        normalized = self.control.budget_preimage(public)
        historical = {'budget': self.control.documents()['budget.json'], 'notifications': copy.deepcopy(public['notifications'])}
        raw_hash = cdn.digest(historical)
        self.assertEqual(normalized, self.control.budget_preimage(historical))
        self.assertEqual(raw_hash, cdn.digest(historical))
        package = {'before': {'budget': None, 'notifications': []}}
        journal = {'plan_sha256': cdn.digest(package), 'steps': [{'before': package['before'], 'after': historical, 'confirmed': False}]}
        self.control.state['budget_progress'] = copy.deepcopy(journal)
        self.assertEqual(normalized, self.control.check_budget_preimage(package, public))
        self.assertEqual(journal, self.control.state['budget_progress'])

    def test_unconfirmed_outcome_cannot_auto_adopt_or_touch_ledger(self):
        self.control.state['pending'] = ['budget']
        self.control.state['budget_progress'] = {'plan_sha256': 'retained', 'steps': [{'confirmed': False}]}
        before = copy.deepcopy(self.control.state)
        self.control.require_phase = lambda package, phase: None
        with self.assertRaisesRegex(cdn.Refusal, 'ownership recovery'):
            self.control.budget({})
        self.assertEqual(before, self.control.state)
        self.assertEqual([], self.aws.calls)
        self.assertFalse((self.folder / 'state').exists())

    def test_pending_alone_is_not_causal_ownership(self):
        self.control.state['pending'] = ['budget']
        before = copy.deepcopy(self.control.state)
        self.control.require_phase = lambda package, phase: None
        package = {'before': self.control.read_budget()[0], 'documents': self.control.documents()}
        with self.assertRaisesRegex(cdn.Refusal, 'causal ownership'):
            self.control.budget(package)
        self.assertEqual(before, self.control.state)
        self.assertFalse((self.folder / 'state').exists())


if __name__ == '__main__':
    unittest.main()
