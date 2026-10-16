import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdir,rm} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const W=require('web-ifc');
export async function fixture(baseline=false){
 await mkdir('preview',{recursive:true});
 await build({entryPoints:['../frontend/src/modules/fourD/integratedIfcExport.ts'],outfile:'preview/exporter.cjs',bundle:true,platform:'node',format:'cjs',external:['web-ifc']});
 const {exportIntegratedIfc}=require('../preview/exporter.cjs');
 const bytes=new TextEncoder().encode(`ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [DesignTransferView]'),'2;1');
FILE_NAME('walls.ifc','2026-10-16T12:00:00',('Prosota'),('Prosota'),'Test','Test','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCPROJECT('0000000000000000000000',$,'Test',$,$,$,$,(#5),#3);
#2=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#3=IFCUNITASSIGNMENT((#2));
#4=IFCCARTESIANPOINT((0.,0.,0.));
#5=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,0.00001,#6,$);
#6=IFCAXIS2PLACEMENT3D(#4,$,$);
#9=IFCLOCALPLACEMENT($,#6);
#10=IFCWALL('0000000000000000000001',$,'Wall',$,$,#9,#16,$,.NOTDEFINED.);
#11=IFCDIRECTION((0.,0.,1.));
#12=IFCCARTESIANPOINT((0.,0.));
#13=IFCAXIS2PLACEMENT2D(#12,$);
#14=IFCRECTANGLEPROFILEDEF(.AREA.,$,#13,2.,0.2);
#15=IFCEXTRUDEDAREASOLID(#14,#6,#11,3.);
#16=IFCPRODUCTDEFINITIONSHAPE($,$,(#17));
#17=IFCSHAPEREPRESENTATION(#5,'Body','SweptSolid',(#15));
ENDSEC;
END-ISO-10303-21;`);
 const task={id:baseline?'base-task':'task',code:'T-001',task_name:'Construct wall',activity_type:'task',parent_id:'summary',start:baseline?'2026-10-01T00:00:00Z':'2026-10-10T00:00:00Z',finish:baseline?'2026-10-09T00:00:00Z':'2026-10-20T00:00:00Z',duration_hours:80,pct_complete:50,status:'planned',bac:1000,ac:400,ev:500,pv:600,animation_profile_id:'green'};
 const data={project:{id:'test',name:'Power BI test'},schedulePeriodId:'test',costPeriodId:'test',currency:'GBP',exportedAt:'2026-10-16T00:00:00Z',activities:[{...task,id:'summary',activity_type:'wbs_summary',parent_id:null},task],relationships:[],resources:[{id:'crew',name:'Crew',resource_type:'labour',unit:'day',rate:100}],assignments:[{id:'assignment',activity_id:task.id,resource_id:'crew',budget:800,planned_hours:64,utilisation_pct:100}],calendars:[],breaks:[],exceptions:[],costs:[],animationProfiles:[{id:'green',name:'Construction',config:{color_from:'#22c55e',opacity_from:0,opacity_to:1}}],links:[{activity_id:task.id,source_kind:'ifc',element_ref:'0000000000000000000001'}]};
 const api=new W.IfcAPI();await api.Init();try{return (await exportIntegratedIfc(api,[{name:'walls.ifc',bytes}],data)).bytes;}finally{api.Dispose();await rm('preview/exporter.cjs',{force:true});}
}
