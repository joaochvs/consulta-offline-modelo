import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from atualizar import consolidate, check_drop, write_db, coordinate
import sqlite3
from contextlib import closing

ROOT = Path(__file__).resolve().parents[2]


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.config = json.loads((ROOT/'projeto.exemplo.json').read_text())
        with (ROOT/'exemplos/base_ficticia.csv').open(encoding='utf-8-sig') as file:
            self.rows = list(csv.DictReader(file, delimiter=';'))

    def test_latest_visit_key_and_allowlist(self):
        self.rows[0]['CPF'] = 'DADO_NAO_PUBLICAVEL'
        result, audit = consolidate(self.rows, self.config)
        self.assertEqual(len(result), 2)
        first = next(r for r in result if r['codigo_unico'] == '00001')
        self.assertEqual(first['numero_visita'], 2)
        self.assertEqual(first['situacao_backoffice'], 'Aprovado')
        self.assertNotIn('CPF', first)
        self.assertEqual(audit['semCodigoUnico'], 1)

    def test_hour_beats_visit_number_and_case_insensitive_keys(self):
        self.rows[1]['Matricula'] = 'ABC'
        self.rows[0]['Matricula'] = 'abc'
        self.rows[0]['Data e hora'] = '2026-01-03 11:00:00'
        result, _ = consolidate(self.rows, self.config)
        self.assertEqual(next(r for r in result if r['codigo_unico'].lower() == 'abc')['numero_visita'], 1)

    def test_block_partial_empty_and_bad_dates(self):
        with self.assertRaises(ValueError): check_drop(100, 90, 5)
        with self.assertRaises(ValueError): check_drop(0, 0, 5)
        self.rows[0]['Data e hora'] = 'data incorreta'
        with self.assertRaises(ValueError): consolidate(self.rows, self.config)

    def test_coordinate_pair_and_photo_policy(self):
        self.rows[0]['Foto'] = 'https://example.com/primeira.jpg'
        self.rows[1]['Foto'] = 'https://example.com/ultima.jpg'
        self.rows[1]['Longitude'] = '999'
        result, _ = consolidate(self.rows, self.config)
        self.assertEqual(result[0]['foto_visita'], 'https://example.com/ultima.jpg')
        self.assertIsNone(result[0]['latitude'])
        self.config['photoPolicy'] = 'first'
        result, _ = consolidate(self.rows, self.config)
        self.assertEqual(result[0]['foto_visita'], 'https://example.com/primeira.jpg')
        self.assertIsNone(coordinate('nan', 90))

    def test_sqlite_contract(self):
        result, _ = consolidate(self.rows, self.config)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'teste.db'
            write_db(result, path)
            with closing(sqlite3.connect(path)) as db:
                self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
                self.assertEqual(db.execute('SELECT COUNT(*) FROM imoveis').fetchone()[0], 2)
                self.assertEqual(db.execute('SELECT codigo_unico FROM imoveis ORDER BY codigo_unico LIMIT 1').fetchone()[0], '00001')


if __name__ == '__main__':
    unittest.main()
