import contextlib
import io
from pathlib import Path
import tempfile
import unittest
import uuid
from unittest.mock import AsyncMock, Mock, patch

import ifcopenshell
from fastapi import HTTPException
from app.services.ifc_conversion_worker import convert
from app.api.model3d_files import ifc4_export_source
from app.services.ifc_conversion import prepare_ifc4, MAX_SOURCE_BYTES
from botocore.exceptions import ClientError


class ConversionTests(unittest.TestCase):
    def test_cached_conversion_does_not_download_or_reconvert(self):
        with patch('app.services.ifc_conversion.object_storage') as storage:
            storage.head_object_size.return_value = 100
            storage.presigned_get_url.return_value = 'signed'
            self.assertEqual(prepare_ifc4(uuid.uuid4(), 'source'), 'signed')
            storage.download_to_path.assert_not_called()

    def test_oversized_source_stops_before_download(self):
        missing = ClientError({'Error': {'Code': '404'}}, 'HeadObject')
        with patch('app.services.ifc_conversion.object_storage') as storage:
            storage.head_object_size.side_effect = [missing, MAX_SOURCE_BYTES + 1]
            with self.assertRaises(HTTPException) as error:
                prepare_ifc4(uuid.uuid4(), 'source')
            self.assertEqual(error.exception.status_code, 413)
            storage.download_to_path.assert_not_called()

    def test_migration_preserves_source_product_geometry_and_properties(self):
        f = ifcopenshell.file(schema='IFC2X3')
        person = f.createIfcPerson(None, None, 'Tester', None, None, None, None, None)
        org = f.createIfcOrganization(None, 'Test', None, None, None)
        user = f.createIfcPersonAndOrganization(person, org, None)
        app = f.createIfcApplication(org, '1', 'Test', 'Test')
        owner = f.createIfcOwnerHistory(user, app, None, 'ADDED', None, None, None, 1791201600)
        point = f.createIfcCartesianPoint((12., 3., 7.))
        axis = f.createIfcAxis2Placement3D(point, None, None)
        placement = f.createIfcLocalPlacement(None, axis)
        context = f.createIfcGeometricRepresentationContext(None, 'Model', 3, .00001, axis, None)
        profile = f.createIfcRectangleProfileDef('AREA', None, f.createIfcAxis2Placement2D(f.createIfcCartesianPoint((0., 0.)), None), 2., .2)
        solid = f.createIfcExtrudedAreaSolid(profile, axis, f.createIfcDirection((0., 0., 1.)), 3.)
        shape = f.createIfcShapeRepresentation(context, 'Body', 'SweptSolid', [solid])
        product_shape = f.createIfcProductDefinitionShape(None, None, [shape])
        guid = ifcopenshell.guid.new()
        wall = f.createIfcWall(guid, owner, 'Wall', None, None, placement, product_shape, None)
        prop = f.createIfcPropertySingleValue('Source property', None, f.createIfcText('Retained'), None)
        pset = f.createIfcPropertySet(ifcopenshell.guid.new(), owner, 'Test', None, [prop])
        f.createIfcRelDefinesByProperties(ifcopenshell.guid.new(), owner, None, None, [wall], pset)
        with tempfile.TemporaryDirectory() as folder:
            source, output = Path(folder)/'source.ifc', Path(folder)/'output.ifc'
            f.write(str(source)); before = source.read_bytes()
            with contextlib.redirect_stdout(io.StringIO()):
                convert(source, output)
            result = ifcopenshell.open(str(output))
            self.assertEqual(result.schema, 'IFC4')
            self.assertEqual(source.read_bytes(), before)
            self.assertEqual(result.by_guid(guid).ObjectPlacement.RelativePlacement.Location.Coordinates, (12., 3., 7.))
            self.assertEqual(result.by_type('IfcExtrudedAreaSolid')[0].Depth, 3.)
            self.assertEqual(result.by_type('IfcPropertySingleValue')[0].NominalValue.wrappedValue, 'Retained')


class ConversionAccessTests(unittest.IsolatedAsyncioTestCase):
    async def test_foreign_project_never_starts_conversion(self):
        db = AsyncMock()
        db.get.side_effect = [Mock(project_id=uuid.uuid4()), Mock(org_id='other', created_by='other')]
        with patch('app.api.model3d_files.prepare_ifc4') as conversion:
            with self.assertRaises(HTTPException) as error:
                await ifc4_export_source(uuid.uuid4(), db, Mock(org_id='mine', id='me'))
            self.assertEqual(error.exception.status_code, 404)
            conversion.assert_not_called()

    async def test_authorised_conversion_uses_server_storage_key(self):
        db = AsyncMock()
        row = Mock(id=uuid.uuid4(), project_id=uuid.uuid4(), kind='ifc', storage_filename='model3d/saved.ifc')
        db.get.side_effect = [row, Mock(org_id='mine', created_by='me')]
        with patch('app.api.model3d_files.run_in_threadpool', AsyncMock(return_value='signed-url')) as run:
            result = await ifc4_export_source(row.id, db, Mock(org_id='mine', id='me'))
            self.assertEqual(result, {'download_url': 'signed-url'})
            self.assertEqual(run.call_args.args[1:], (row.id, row.storage_filename))
