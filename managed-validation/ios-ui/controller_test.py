import importlib.util,pathlib,tempfile,unittest,os,json,hashlib,ast
HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('controller',HERE/'controller.py');c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
class Guards(unittest.TestCase):
 def test_inventory_changes_for_content_mode_or_link(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);p=root/'fixed';p.write_text('owned');before=c.inventory(root);p.write_text('changed');self.assertNotEqual(before,c.inventory(root));before=c.inventory(root);p.chmod(0o644 if p.stat().st_mode&0o777==0o600 else 0o600);self.assertNotEqual(before,c.inventory(root));(root/'link').symlink_to('fixed');self.assertEqual(c.inventory(root)[1]['kind'],'link')
 def test_inventory_rejects_escape_without_reading_target(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);(root/'escape').symlink_to('/etc/passwd')
   with self.assertRaises(AssertionError):c.inventory(root)
 def test_no_uninstall_or_arbitrary_target(self):
  s=(HERE/'controller.py').read_text();self.assertNotIn("'uninstall'",s);self.assertIn("APP='dev.blackcrab.remote'",s);self.assertIn('user_approved_xctest_and_owned_credential',s);self.assertIn('privateRawOnly',s);self.assertIn('codesign',s)
 def test_sources_match_review_pins(self):
  pins=json.loads((HERE/'artifact-pins.json').read_text())
  for name,h in pins['sources'].items():self.assertEqual(c.sha((HERE/name).read_bytes()),h,name)

class ResultAndCopyGuards(unittest.TestCase):
 def summary(self):return {'result':'Passed','totalTestCount':1,'passedTests':1,'failedTests':0,'skippedTests':0,'expectedFailures':0,'testFailures':[]}
 def test_exact_pass_only(self):
  c.require_one_pass(self.summary())
  for key,value in [('result','Skipped'),('result','unknown'),('totalTestCount',0),('totalTestCount',2),('passedTests',0),('skippedTests',1),('failedTests',1),('expectedFailures',1),('passedTests',True),('testFailures',[{}])]:
   s=self.summary();s[key]=value
   with self.subTest(key=key,value=value),self.assertRaises(AssertionError):c.require_one_pass(s)
  s=self.summary();del s['skippedTests']
  with self.assertRaises(AssertionError):c.require_one_pass(s)
 def test_tree_rejects_wrong_case_device_and_retries(self):
  tree={'devices':[{'deviceId':'OWN'}],'testNodes':[{'nodeType':'Test Case','name':c.TEST_CASE,'nodeIdentifier':'Acceptance/'+c.TEST_CASE,'result':'Passed'}]}
  self.assertEqual(c.passed_test_id(tree,'OWN'),'Acceptance/'+c.TEST_CASE)
  with self.assertRaises(AssertionError):c.passed_test_id(tree,'OTHER')
  tree['testNodes'][0]['nodeIdentifier']='OtherAcceptance/'+c.TEST_CASE
  with self.assertRaises(AssertionError):c.passed_test_id(tree,'OWN')
  tree['testNodes'][0]['nodeIdentifier']='Acceptance/'+c.TEST_CASE
  tree['testNodes'][0]['result']='Skipped'
  with self.assertRaises(AssertionError):c.passed_test_id(tree,'OWN')
 def test_phase_receipt_requires_exact_single_nonce_bound_attachment(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);p=root/'receipt.json';expected={'kind':'blackcrab-phase-completion-v1','phase':'logging-canary','nonce':'N','deviceUUID':'OWN'};p.write_text(json.dumps(expected))
   manifest=[{'testIdentifier':'T','attachments':[{'exportedFileName':p.name,'suggestedHumanReadableName':'blackcrab-phase-completion.json','deviceId':'OWN','isAssociatedWithFailure':False}]}]
   self.assertEqual(c.completion_receipt(manifest,root,'T','logging-canary','N','OWN'),expected)
   for nonce in ['wrong','']:
    with self.assertRaises(AssertionError):c.completion_receipt(manifest,root,'T','logging-canary',nonce,'OWN')
   with self.assertRaises(AssertionError):c.completion_receipt([],root,'T','logging-canary','N','OWN')
   with self.assertRaises(AssertionError):c.completion_receipt(manifest*2,root,'T','logging-canary','N','OWN')
   manifest[0]['attachments'][0]['exportedFileName']='../escape'
   with self.assertRaises(AssertionError):c.completion_receipt(manifest,root,'T','logging-canary','N','OWN')
 def test_host_copy_matches_bytes_modes_and_links(self):
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);src=root/'source';src.mkdir();(src/'blackcrab-managed-host.json').write_text('{}');(src/'payload').write_text('fixed');(src/'payload').chmod(0o755);(src/'alias').symlink_to('payload');dest=root/'copy'
   with patch.object(c,'HOST_SHA',c.sha(b'{}')):
    records=c.copy_verified_host(src,dest);self.assertEqual(records,c.host_inventory(dest));self.assertEqual(dest.stat().st_mode&0o777,0o700)
    with self.assertRaises(AssertionError):c.copy_verified_host(src,dest)
 def test_host_copy_rejects_copy_corruption(self):
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);src=root/'source';src.mkdir();(src/'blackcrab-managed-host.json').write_text('{}');(src/'payload').write_text('fixed');original=c.shutil.copytree
   def corrupt(*args,**kwargs):
    result=original(*args,**kwargs);(pathlib.Path(args[1])/'payload').write_text('wrong');return result
   with patch.object(c,'HOST_SHA',c.sha(b'{}')),patch.object(c.shutil,'copytree',side_effect=corrupt):
    with self.assertRaises(AssertionError):c.copy_verified_host(src,root/'copy')


class ControllerPhaseGuards(unittest.TestCase):
 def test_zero_exit_skip_does_not_complete_phase(self):
  from unittest.mock import Mock
  import plistlib
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);products=root/'DerivedData/Build/Products';products.mkdir(parents=True);(products/'fixture.xctestrun').write_bytes(plistlib.dumps(PrebuiltRunnerGuards().descriptor()))
   obj=c.Controller.__new__(c.Controller);obj.root=root;obj.low=False;obj.device=Mock(return_value={'state':'Booted'});obj.run=Mock(return_value=0)
   obj.official_json=Mock(return_value={'result':'Skipped','totalTestCount':1,'passedTests':0,'failedTests':0,'skippedTests':1,'expectedFailures':0,'testFailures':[]})
   r={'nonce':'nonce','name':'owned','uuid':'uuid'}
   with self.assertRaises(AssertionError):obj.test(r,'logging-canary',{'origin':'http://127.0.0.1:9/','credential':'23456789ABCD'},True)
   self.assertEqual(obj.official_json.call_count,1);self.assertFalse((root/'canary-receipt.json').exists())
 def test_host_copy_rejects_mode_and_link_tampering(self):
  from unittest.mock import patch
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);src=root/'source';src.mkdir();(src/'blackcrab-managed-host.json').write_text('{}');(src/'payload').write_text('fixed');(src/'alias').symlink_to('payload');original=c.shutil.copytree
   for kind in ['mode','link']:
    def corrupt(*args,**kwargs):
     result=original(*args,**kwargs);dest=pathlib.Path(args[1])
     if kind=='mode':(dest/'payload').chmod(0o777)
     else:(dest/'alias').unlink();(dest/'alias').symlink_to('blackcrab-managed-host.json')
     return result
    with patch.object(c,'HOST_SHA',c.sha(b'{}')),patch.object(c.shutil,'copytree',side_effect=corrupt):
     with self.subTest(kind=kind),self.assertRaises(AssertionError):c.copy_verified_host(src,root/kind)


class InterpreterGuards(unittest.TestCase):
 def test_optimized_import_is_rejected(self):
  import subprocess,sys
  result=subprocess.run([sys.executable,'-O','-c','import runpy;runpy.run_path('+repr(str(HERE/'controller.py'))+')'],capture_output=True,text=True,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
  self.assertNotEqual(result.returncode,0);self.assertIn('Optimized Python execution is prohibited',result.stderr)


class MountQueryGuards(unittest.TestCase):
 def test_nested_or_missing_reported_mount_rejected(self):
  from unittest.mock import patch
  import plistlib
  with tempfile.TemporaryDirectory() as d:
   for info in [{'DeviceIdentifier':'diskFake'},{'DeviceIdentifier':'diskFake','MountPoint':d}]:
    with patch.object(c.subprocess,'check_output',return_value=plistlib.dumps(info)):
     with self.assertRaises(AssertionError):c.filesystem_info(pathlib.Path(d))


class RpcGuards(unittest.TestCase):
 def test_eof_is_not_an_infinite_read_loop(self):
  from unittest.mock import MagicMock,patch
  obj=c.Controller.__new__(c.Controller);obj.root=pathlib.Path('/unused-owned-root');obj.low=False
  client=MagicMock();client.recv.return_value=b''
  with patch.object(c.socket,'socket') as create:
   create.return_value.__enter__.return_value=client
   with self.assertRaises(RuntimeError):obj.rpc('status')
   self.assertEqual(client.recv.call_count,1)



class PrebuiltRunnerGuards(unittest.TestCase):
 def descriptor(self):
  prefix='__TESTROOT__/Debug-iphonesimulator/Acceptance-Runner.app'
  return {'__xctestrun_metadata__':{'FormatVersion':1},'Acceptance':{'TestHostPath':prefix,'TestBundlePath':'__TESTHOST__/PlugIns/Acceptance.xctest','TestHostBundleIdentifier':'dev.blackcrab.acceptance.ui.xctrunner','ProductModuleName':'Acceptance','BlueprintName':'Acceptance','IsUITestBundle':True,'IsXCTRunnerHostedTestBundle':True,'UseUITargetAppProvidedByTests':True,'DependentProductPaths':[prefix,prefix+'/PlugIns/Acceptance.xctest'],'EnvironmentVariables':{},'TestingEnvironmentVariables':{'DYLD_FRAMEWORK_PATH':'__TESTROOT__/Debug-iphonesimulator:__PLATFORMS__/iPhoneSimulator.platform/Developer/Library/Frameworks'}}}
 def fake(self,root):
  import plistlib
  products=root/'DerivedData/Build/Products';app=products/'Debug-iphonesimulator/Acceptance-Runner.app';bundle=app/'PlugIns/Acceptance.xctest';bundle.mkdir(parents=True)
  for directory,identifier,executable,minimum in [(app,'dev.blackcrab.acceptance.ui.xctrunner','Acceptance-Runner','17.0'),(bundle,'dev.blackcrab.acceptance.ui','Acceptance','18.0')]:
   (directory/'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':identifier,'CFBundleExecutable':executable,'MinimumOSVersion':minimum,'DTPlatformName':'iphonesimulator','DTXcodeBuild':c.XCODE_BUILD,'CFBundleSupportedPlatforms':['iPhoneSimulator']}));(directory/executable).write_bytes(b'fixture-runner');(directory/executable).chmod(0o755)
  binary=bundle/'Acceptance';descriptor=products/'Acceptance_iphonesimulator27.1-arm64.xctestrun';descriptor.write_bytes(plistlib.dumps(self.descriptor()))
  source={name:c.sha((HERE/name).read_bytes())for name in ['Acceptance.swift','Acceptance.xcodeproj/project.pbxproj','Acceptance.xcodeproj/xcshareddata/xcschemes/Acceptance.xcscheme']}
  (root/'runner-build-summary.json').write_text(json.dumps({'buildForTestingPassed':True,'uiTestsExecuted':False,'simulatorBooted':False,'credentialsCreated':False,'executableSha256':c.sha(binary.read_bytes()),'runnerSourceSha256':source,'xctestrun':str(descriptor),'testExecutable':str(binary),'testBundle':str(bundle)}))
  pins={'sources':source,'prebuiltRunner':{'root':str(root),'xcodeBuild':c.XCODE_BUILD,'executableSha256':c.sha(binary.read_bytes()),'inventorySha256':c.sha(json.dumps(c.inventory(products),sort_keys=True).encode()),'descriptorName':descriptor.name,'descriptorSha256':c.sha(descriptor.read_bytes())}}
  return pins,products,descriptor,binary
 def test_exact_runner_is_eligible_but_tampered_binary_cannot_be_rehashed_into_authority(self):
  from unittest.mock import patch
  with tempfile.TemporaryDirectory()as d:
   root=pathlib.Path(d).resolve();pins,products,descriptor,binary=self.fake(root)
   with patch.object(c,'PREBUILT_ROOT',root),patch.object(c,'PREBUILT_RUNNER_SHA',pins['prebuiltRunner']['executableSha256']),patch.object(c,'private',return_value=root):
    self.assertEqual(c.verify_prebuilt_runner(pins)[0],products);binary.write_bytes(b'tampered');pins['prebuiltRunner']['inventorySha256']=c.sha(json.dumps(c.inventory(products),sort_keys=True).encode())
    with self.assertRaises(AssertionError):c.verify_prebuilt_runner(pins)
 def test_rehashed_wrong_target_or_unrelated_app_path_is_rejected(self):
  import plistlib
  from unittest.mock import patch
  with tempfile.TemporaryDirectory()as d:
   root=pathlib.Path(d).resolve();pins,products,descriptor,binary=self.fake(root);data=plistlib.loads(descriptor.read_bytes());data['Acceptance']['TestHostPath']='/Applications/Unrelated.app';descriptor.write_bytes(plistlib.dumps(data));pins['prebuiltRunner']['descriptorSha256']=c.sha(descriptor.read_bytes());pins['prebuiltRunner']['inventorySha256']=c.sha(json.dumps(c.inventory(products),sort_keys=True).encode())
   with patch.object(c,'PREBUILT_ROOT',root),patch.object(c,'PREBUILT_RUNNER_SHA',pins['prebuiltRunner']['executableSha256']),patch.object(c,'private',return_value=root):
    with self.assertRaises(AssertionError):c.verify_prebuilt_runner(pins)
  data=self.descriptor();data['Acceptance']['UITargetAppPath']='/Applications/Unrelated.app'
  with self.assertRaises(AssertionError):c.validate_runner_descriptor(data,pathlib.Path('/private/owned/products'))
 def test_phase_descriptor_rebases_product_paths_without_retargeting_testhost(self):
  products=pathlib.Path('/private/owned/run/DerivedData/Build/Products');original=self.descriptor();changed=c.rebase_runner_descriptor(original,products)
  self.assertEqual(original['Acceptance']['TestHostPath'],'__TESTROOT__/Debug-iphonesimulator/Acceptance-Runner.app');self.assertEqual(changed['Acceptance']['TestHostPath'],str(products/'Debug-iphonesimulator/Acceptance-Runner.app'));self.assertEqual(changed['Acceptance']['TestBundlePath'],'__TESTHOST__/PlugIns/Acceptance.xctest');self.assertIn('__PLATFORMS__',changed['Acceptance']['TestingEnvironmentVariables']['DYLD_FRAMEWORK_PATH']);c.validate_runner_descriptor(changed,products,True)
 def test_deployment_metadata_and_mutated_source_receipt_fail_closed(self):
  import plistlib
  from unittest.mock import patch
  with tempfile.TemporaryDirectory()as d:
   root=pathlib.Path(d).resolve();pins,products,descriptor,binary=self.fake(root);info=binary.parent/'Info.plist';value=plistlib.loads(info.read_bytes());value['MinimumOSVersion']='27.1';info.write_bytes(plistlib.dumps(value));pins['prebuiltRunner']['inventorySha256']=c.sha(json.dumps(c.inventory(products),sort_keys=True).encode())
   with patch.object(c,'PREBUILT_ROOT',root),patch.object(c,'PREBUILT_RUNNER_SHA',pins['prebuiltRunner']['executableSha256']),patch.object(c,'private',return_value=root):
    with self.assertRaises(AssertionError):c.verify_prebuilt_runner(pins)
   summary=json.loads((root/'runner-build-summary.json').read_text());summary['runnerSourceSha256']['Acceptance.swift']='0'*64;(root/'runner-build-summary.json').write_text(json.dumps(summary))
   with patch.object(c,'PREBUILT_ROOT',root),patch.object(c,'PREBUILT_RUNNER_SHA',pins['prebuiltRunner']['executableSha256']),patch.object(c,'private',return_value=root):
    with self.assertRaises(AssertionError):c.verify_prebuilt_runner(pins)
 def test_execute_never_rebuilds_runner_and_headroom_is_stable(self):
  from unittest.mock import patch
  tree=ast.parse((HERE/'controller.py').read_text());execute=next(n for n in ast.walk(tree)if isinstance(n,ast.FunctionDef)and n.name=='execute');calls=[n.func.attr for n in ast.walk(execute)if isinstance(n,ast.Call)and isinstance(n.func,ast.Attribute)]
  self.assertIn('reuse_prebuilt_runner',calls);self.assertNotIn('build_runner',calls)
  class Space:f_bavail=7*2**30;f_frsize=1
  with patch.object(c.os,'statvfs',return_value=Space()),patch.object(c.time,'sleep')as sleep:c.stable_internal_headroom();self.assertEqual(sleep.call_count,3)
  class Low:f_bavail=6*2**30-1;f_frsize=1
  with patch.object(c.os,'statvfs',side_effect=[Space(),Low()]),patch.object(c.time,'sleep'):
   with self.assertRaises(AssertionError):c.stable_internal_headroom()


class InstalledModePolicy(unittest.TestCase):
 def fixture(self,root):
  import struct,plistlib,shutil
  source=root/'source';source.mkdir();(source/'BlackcrabRemote').write_bytes(b'main');(source/'BlackcrabRemote').chmod(0o755)
  for path in c.INSTALL_FRAMEWORK_MODE_PATHS:
   binary=source/path;binary.parent.mkdir(parents=True);binary.write_bytes(b'\xca\xfe\xba\xbe'+struct.pack('>6I',1,0x0100000c,0,32,32,5)+b'\0'*4+b'\xcf\xfa\xed\xfe'+struct.pack('<7I',0x0100000c,0,6,0,0,0,0));binary.chmod(0o755)
   (binary.parent/'Info.plist').write_bytes(plistlib.dumps({'CFBundlePackageType':'FMWK','CFBundleExecutable':binary.name}))
  installed=root/'installed';shutil.copytree(source,installed)
  for path in c.INSTALL_FRAMEWORK_MODE_PATHS:(installed/path).chmod(0o644)
  expected=c.sha(json.dumps(c.inventory(source),sort_keys=True).encode());return source,installed,expected
 def test_exact_observed_ten_changes_require_signature(self):
  with tempfile.TemporaryDirectory() as d:
   source,installed,expected=self.fixture(pathlib.Path(d));calls=[]
   self.assertEqual(c.verify_installed_bundle(source,installed,expected,lambda p:calls.append(p)),sorted(c.INSTALL_FRAMEWORK_MODE_PATHS));self.assertEqual(calls,[installed])
   def reject(_):raise ValueError('invalid signature')
   with self.assertRaises(ValueError):c.verify_installed_bundle(source,installed,expected,reject)
 def test_all_other_inventory_changes_rejected(self):
  for change in ['bytes','main-mode','unknown-framework','mode777','type','missing','extra']:
   with self.subTest(change=change),tempfile.TemporaryDirectory() as d:
    source,installed,expected=self.fixture(pathlib.Path(d));path=installed/sorted(c.INSTALL_FRAMEWORK_MODE_PATHS)[0]
    if change=='bytes':path.write_bytes(b'wrong')
    elif change=='main-mode':(installed/'BlackcrabRemote').chmod(0o644)
    elif change=='unknown-framework':
     import shutil
     for app in [source,installed]:shutil.copytree(app/'Frameworks/ExpoCamera.framework',app/'Frameworks/Unknown.framework')
     (source/'Frameworks/Unknown.framework/ExpoCamera').chmod(0o755);expected=c.sha(json.dumps(c.inventory(source),sort_keys=True).encode())
    elif change=='mode777':path.chmod(0o777)
    elif change=='type':path.unlink();path.mkdir()
    elif change=='missing':path.unlink()
    elif change=='extra':(installed/'unexpected').write_bytes(b'extra')
    with self.assertRaises(AssertionError):c.verify_installed_bundle(source,installed,expected,lambda _:None)

 def test_source_metadata_and_dylib_header_are_required(self):
  import plistlib,shutil
  for change in ['executable','package-type','macho','source-pin']:
   with self.subTest(change=change),tempfile.TemporaryDirectory() as d:
    source,installed,expected=self.fixture(pathlib.Path(d));name=sorted(c.INSTALL_FRAMEWORK_MODE_PATHS)[0];path=source/name;info=path.parent/'Info.plist'
    if change in ['executable','package-type']:
     value=plistlib.loads(info.read_bytes());value['CFBundleExecutable' if change=='executable' else 'CFBundlePackageType']='wrong';info.write_bytes(plistlib.dumps(value));shutil.copy2(info,(installed/name).parent/'Info.plist')
    elif change=='macho':
     b=bytearray(path.read_bytes());b[44:48]=(2).to_bytes(4,'little');path.write_bytes(b);(installed/name).write_bytes(b)
    if change!='source-pin':expected=c.sha(json.dumps(c.inventory(source),sort_keys=True).encode())
    else:expected='0'*64
    with self.assertRaises(AssertionError):c.verify_installed_bundle(source,installed,expected,lambda _:None)

class CleanupOwnershipGuards(unittest.TestCase):
 def test_plausible_saved_host_record_never_authorizes_signal(self):
  from unittest.mock import patch
  from types import SimpleNamespace
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);ctl=c.Controller.__new__(c.Controller);ctl.root=root
   ctl.fixture=SimpleNamespace(poll=lambda:0)
   capture=root/'captured-host.private.json'
   capture.write_text(json.dumps({'pid':43210,'pgid':43210,'root':str(root/'native-control-host'),'started':'same-start','closed':False}))
   def observed(args,**kw):return 'same-start' if 'lstart=' in args else str(root/'native-control-host')
   with patch.object(c.os,'killpg') as signals,patch.object(c.os,'getpgid',return_value=43210),patch.object(c.os,'kill',side_effect=ProcessLookupError),patch.object(c.subprocess,'check_output',side_effect=observed):
    with self.assertRaisesRegex(RuntimeError,'cleanup uncertain'):ctl.cleanup_fixture()
    signals.assert_not_called()
   self.assertFalse(json.loads(capture.read_text())['closed'])
 def test_missing_host_receipt_is_uncertain_after_fixture_started(self):
  from types import SimpleNamespace
  with tempfile.TemporaryDirectory() as d:
   ctl=c.Controller.__new__(c.Controller);ctl.root=pathlib.Path(d);ctl.fixture=SimpleNamespace(poll=lambda:0)
   with self.assertRaisesRegex(RuntimeError,'observation missing'):ctl.cleanup_fixture()
 def test_closed_observation_and_no_host_canary_need_no_signals(self):
  from unittest.mock import patch
  from types import SimpleNamespace
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);ctl=c.Controller.__new__(c.Controller);ctl.root=root
   with patch.object(c.os,'killpg') as signals:
    ctl.cleanup_fixture()
    ctl.fixture=SimpleNamespace(poll=lambda:0)
    (root/'captured-host.private.json').write_text(json.dumps({'closed':True}))
    ctl.cleanup_fixture();signals.assert_not_called()

if __name__=='__main__':unittest.main()
