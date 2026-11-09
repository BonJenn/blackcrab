#!/usr/bin/env python3
"""Fixed-app owned-simulator acceptance. NO execution without explicit approval.
All subprocess output, xctestrun environment, credential inputs and xcresults are
private APFS files. Nothing value-bearing is printed or copied into Git.
"""
import sys
if not __debug__ or sys.flags.optimize:
 raise SystemExit("Optimized Python execution is prohibited; validation must remain enabled")
import argparse, hashlib, json, os, pathlib, plistlib, re, socket, sqlite3, stat, subprocess, time, uuid, threading, signal, tempfile, shutil
HERE=pathlib.Path(__file__).resolve().parent
REV='47b65a55da249591e387cf0beca31a7b55ce44c5'; BASE='2fa3808fb4d359f3bd00b2f0ed5ce091781c9bab'
HOST_SHA='afdbaf815be9d676657939f1235290de5765b81ac008f11f3836b7cb80a9041e'
APP='dev.blackcrab.remote'; NODE='/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/toolchain/node_modules/.bin/node'
VALIDATION=pathlib.Path('/private/tmp/blackcrab-x532-sdk-9yme1azk/Root-QA/compiler-preparation-fo3vvxjg/blackcrab-ios-OkMeN2/repo')
BASE_APP=pathlib.Path('/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/blackcrab-ios-derived-oWFrUz/Build/Products/Release-iphonesimulator/BlackcrabRemote.app')
NEW_APP=pathlib.Path('/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/compiler-preparation-fo3vvxjg/release-build/DerivedData/Build/Products/Release-iphonesimulator/BlackcrabRemote.app')
HOST=pathlib.Path('/Volumes/G-DRIVE PRO/Programming/.blackcrab-parity-probes/host-proof9-managed-runtime')
PREBUILT_ROOT=pathlib.Path('/private/tmp/blackcrab-c603-owned-2yw0xkm4/Root-QA/xctest-private-igatoscw')
PREBUILT_RUNNER_SHA='e1a9b5399f85f1d723901334e25aa209334b94311954168579a1755fd0197d2c'
XCODE_BUILD='27A9275'
RUNTIME='com.apple.CoreSimulator.SimRuntime.iOS-26-2'
DEVICE_TYPE='com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro'
def sha(b):return hashlib.sha256(b).hexdigest()
def write(p,obj):
 p=pathlib.Path(p);p.write_text(json.dumps(obj,sort_keys=True,indent=2));p.chmod(0o600)
def inventory(root):
 root=root.resolve(strict=True);out=[]
 for parent,dirs,files in os.walk(root,followlinks=False):
  for name in sorted(dirs+files):
   p=pathlib.Path(parent)/name;s=p.lstat();item={'path':str(p.relative_to(root)),'mode':stat.S_IMODE(s.st_mode)}
   if p.is_symlink():
    assert p.resolve(strict=True).is_relative_to(root);item.update(kind='link',target=os.readlink(p))
   elif p.is_file():item.update(kind='file',sha256=sha(p.read_bytes()))
   elif p.is_dir():item.update(kind='directory')
   else:raise ValueError('Unexpected artifact entry')
   out.append(item)
 return sorted(out,key=lambda x:x['path'])
# Exact ten mode-only differences observed on owned iOS26.2 install E6EFC55C.
# This is a pinned-artifact policy, not a general simulator normalization rule.
INSTALL_FRAMEWORK_MODE_PATHS=frozenset('Frameworks/'+n+'.framework/'+n for n in (
 'ExpoCamera','ExpoCameraBarcodeScanning','ExpoFileSystem','ExpoFont','ExpoImage',
 'ExpoImageManipulator','ExpoModulesCore','ExpoModulesJSI','ExpoModulesWorklets','hermesvm'))
# Exact additional mode-only transforms observed on the pinned c603 widget.
# These are thin dylibs, not framework executables or extension entrypoints.
INSTALL_WIDGET_DYLIB_MODES={
 'PlugIns/ExpoWidgetsTarget.appex/ExpoWidgetsTarget.debug.dylib':'656542344f4789dc0ab039a066d10c4f4d9e1db43bbb89d2a72a5d451baf69d7',
 'PlugIns/ExpoWidgetsTarget.appex/__preview.dylib':'1aaf030af2fcad923a762b218e64a058a17ce1828333dd42d944d26587412c1f',
}
def require_widget_dylib(binary,expected):
 import struct
 assert sha(binary.read_bytes())==expected
 info=binary.parent/'Info.plist'
 assert stat.S_ISREG(info.lstat().st_mode) and not info.is_symlink()
 metadata=plistlib.loads(info.read_bytes())
 assert metadata['CFBundlePackageType']=='XPC!' and metadata['CFBundleIdentifier']==APP+'.widgets' and metadata['CFBundleExecutable']=='ExpoWidgetsTarget'
 assert metadata['DTPlatformName']=='iphonesimulator' and metadata['CFBundleSupportedPlatforms']==['iPhoneSimulator'] and metadata['MinimumOSVersion']=='18.0'
 with binary.open('rb') as f:header=f.read(32)
 assert len(header)==32 and header[:4]==b'\xcf\xfa\xed\xfe'
 cpu,subtype,kind,commands,size,flags,reserved=struct.unpack('<7I',header[4:])
 assert cpu==0x0100000c and kind==6 and commands<=size//8 and size<=binary.stat().st_size-32

def require_arm64_dylib(path):
 import struct
 with path.open('rb') as f:
  header=f.read(28)
  # Both pinned artifacts contain one arm64 slice in a big-endian FAT32 header.
  assert len(header)==28 and header[:4]==b'\xca\xfe\xba\xbe'
  count,cpu,subtype,offset,size,alignment=struct.unpack('>6I',header[4:])
  assert count==1 and cpu==0x0100000c and 28<=offset and size>=32 and offset+size==path.stat().st_size and alignment<=30 and offset%(1<<alignment)==0
  f.seek(offset);thin=f.read(32)
  assert thin[:4]==b'\xcf\xfa\xed\xfe' and struct.unpack('<I',thin[4:8])[0]==cpu and struct.unpack('<I',thin[12:16])[0]==6 # MH_DYLIB

INSTALL_CURRENT_DIRECTORY_INVENTORY='1df1d4d49950bc805a3b33487957c22ed77f55e1e3fc8fff31b434d900136c4f'
INSTALL_CURRENT_DIRECTORY_MODES=frozenset('Frameworks/'+name+'.framework'+suffix for name in ('SDWebImage','SDWebImageAVIFCoder','SDWebImageSVGCoder','SDWebImageWebPCoder','ZXingObjC','libavif') for suffix in ('','/_CodeSignature'))

def verify_installed_bundle(source,installed,expected,verify_signature):
 original=inventory(source);actual=inventory(installed)
 assert sha(json.dumps(original,sort_keys=True).encode())==expected
 left={r['path']:r for r in original};right={r['path']:r for r in actual}
 assert left.keys()==right.keys();transformed=[]
 for path,before in left.items():
  after=right[path]
  if before==after:continue
  if expected==INSTALL_CURRENT_DIRECTORY_INVENTORY and path in INSTALL_CURRENT_DIRECTORY_MODES:
   assert before['kind']==after['kind']=='directory' and before['mode']==0o700 and after['mode']==0o755
   assert {k:v for k,v in before.items() if k!='mode'}=={k:v for k,v in after.items() if k!='mode'}
   transformed.append(path)
   continue
  assert path in INSTALL_FRAMEWORK_MODE_PATHS or path in INSTALL_WIDGET_DYLIB_MODES
  assert before['kind']==after['kind']=='file'
  assert before['mode']==0o755 and after['mode']==0o644
  assert {k:v for k,v in before.items() if k!='mode'}=={k:v for k,v in after.items() if k!='mode'}
  binary=source/path
  if path in INSTALL_WIDGET_DYLIB_MODES:require_widget_dylib(binary,INSTALL_WIDGET_DYLIB_MODES[path])
  else:
   framework=binary.parent;info=framework/'Info.plist'
   assert stat.S_ISREG(info.lstat().st_mode) and not info.is_symlink()
   metadata=plistlib.loads(info.read_bytes());assert metadata['CFBundlePackageType']=='FMWK' and metadata['CFBundleExecutable']==binary.name
   require_arm64_dylib(binary)
  transformed.append(path)
 # A matching inventory never substitutes for installed code-signature verification.
 verify_signature(installed)
 return sorted(transformed)

def filesystem_info(path):
 mount=path.resolve(strict=True);device=mount.stat().st_dev
 if not mount.is_dir():mount=mount.parent
 while mount.parent!=mount and mount.parent.stat().st_dev==mount.stat().st_dev:mount=mount.parent
 info=plistlib.loads(subprocess.check_output(['diskutil','info','-plist',str(mount)]))
 assert isinstance(info.get('MountPoint'),str) and isinstance(info.get('DeviceIdentifier'),str) and info['DeviceIdentifier']
 reported=pathlib.Path(info['MountPoint']).resolve(strict=True);assert reported==mount and reported.stat().st_dev==device
 return info
def private(root):
 root=root.resolve(strict=True);s=root.stat();assert s.st_uid==os.getuid() and stat.S_IMODE(s.st_mode)==0o700
 info=filesystem_info(root);assert info['FilesystemType']=='apfs' and info['GlobalPermissionsEnabled'] is True
 assert os.statvfs(root).f_bavail*os.statvfs(root).f_frsize>=2*2**30
 return root

def version_tuple(value):
 assert isinstance(value,str) and re.fullmatch(r'[0-9]+(?:\.[0-9]+){0,2}',value)
 return tuple(int(x) for x in value.split('.'))+(0,)*(3-len(value.split('.')))

def validate_runner_descriptor(data,products,rebased=False):
 assert set(data)=={'Acceptance','__xctestrun_metadata__'} and data['__xctestrun_metadata__']['FormatVersion']==1
 target=data['Acceptance'];prefix=str(products) if rebased else '__TESTROOT__'
 assert target['TestHostPath']==prefix+'/Debug-iphonesimulator/Acceptance-Runner.app'
 assert target['TestBundlePath']=='__TESTHOST__/PlugIns/Acceptance.xctest'
 assert target['TestHostBundleIdentifier']=='dev.blackcrab.acceptance.ui.xctrunner'
 assert target['ProductModuleName']=='Acceptance' and target['BlueprintName']=='Acceptance'
 assert target.get('CommandLineArguments',[])==[] and target.get('UITargetAppCommandLineArguments',[])==[] and target.get('ToolchainsSettingValue',[])==[]
 assert target['IsUITestBundle'] is True and target['IsXCTRunnerHostedTestBundle'] is True and target['UseUITargetAppProvidedByTests'] is True
 assert target['DependentProductPaths']==[prefix+'/Debug-iphonesimulator/Acceptance-Runner.app',prefix+'/Debug-iphonesimulator/Acceptance-Runner.app/PlugIns/Acceptance.xctest']
 assert 'UITargetAppPath' not in target and 'UITargetAppBundleIdentifier' not in target
 return target

def rebase_runner_descriptor(data,products):
 validate_runner_descriptor(data,products)
 def visit(value):
  if isinstance(value,dict):return {k:visit(v) for k,v in value.items()}
  if isinstance(value,list):return [visit(v) for v in value]
  if isinstance(value,str):return value.replace('__TESTROOT__',str(products))
  return value
 result=visit(data);validate_runner_descriptor(result,products,True);return result

def verify_prebuilt_runner(pins):
 expected=pins['prebuiltRunner'];assert expected['root']==str(PREBUILT_ROOT) and expected['executableSha256']==PREBUILT_RUNNER_SHA and expected['xcodeBuild']==XCODE_BUILD
 private(PREBUILT_ROOT);products=PREBUILT_ROOT/'DerivedData/Build/Products'
 assert products.resolve(strict=True)==products and not products.is_symlink()
 summary=json.loads((PREBUILT_ROOT/'runner-build-summary.json').read_text())
 assert summary['buildForTestingPassed'] is True and summary['uiTestsExecuted'] is False and summary['simulatorBooted'] is False and summary['credentialsCreated'] is False
 assert summary['executableSha256']==PREBUILT_RUNNER_SHA
 for name,h in summary['runnerSourceSha256'].items():assert name in pins['sources'] and sha((HERE/name).read_bytes())==h==pins['sources'][name]
 assert set(summary['runnerSourceSha256'])=={'Acceptance.swift','Acceptance.xcodeproj/project.pbxproj','Acceptance.xcodeproj/xcshareddata/xcschemes/Acceptance.xcscheme'}
 assert sha(json.dumps(inventory(products),sort_keys=True).encode())==expected['inventorySha256']
 descriptor=products/expected['descriptorName'];assert descriptor.name=='Acceptance_iphonesimulator27.1-arm64.xctestrun' and sha(descriptor.read_bytes())==expected['descriptorSha256']
 assert pathlib.Path(summary['xctestrun'])==descriptor
 validate_runner_descriptor(plistlib.loads(descriptor.read_bytes()),products)
 app=products/'Debug-iphonesimulator/Acceptance-Runner.app';bundle=app/'PlugIns/Acceptance.xctest'
 for directory,identifier,executable in [(app,'dev.blackcrab.acceptance.ui.xctrunner','Acceptance-Runner'),(bundle,'dev.blackcrab.acceptance.ui','Acceptance')]:
  info=plistlib.loads((directory/'Info.plist').read_bytes())
  assert info['CFBundleIdentifier']==identifier and info['CFBundleExecutable']==executable and info['DTPlatformName']=='iphonesimulator' and info['CFBundleSupportedPlatforms']==['iPhoneSimulator']
  assert version_tuple(info['MinimumOSVersion'])<=version_tuple('26.2')
 assert plistlib.loads((bundle/'Info.plist').read_bytes())['DTXcodeBuild']==XCODE_BUILD
 binary=bundle/'Acceptance';assert pathlib.Path(summary['testBundle'])==bundle and pathlib.Path(summary['testExecutable'])==binary and sha(binary.read_bytes())==PREBUILT_RUNNER_SHA and binary.stat().st_mode&0o111
 return products,descriptor,app,binary

def verify_runtime_and_apps():
 safe={'PATH':'/usr/bin:/bin:/usr/sbin:/sbin','LANG':'en_US.UTF-8'}
 assert subprocess.check_output(['/usr/bin/xcodebuild','-version'],text=True,env=safe).strip()=='Xcode 27.1\nBuild version '+XCODE_BUILD
 data=json.loads(subprocess.check_output(['/usr/bin/xcrun','simctl','list','runtimes','-j'],env=safe));matches=[r for r in data['runtimes'] if r['identifier']==RUNTIME]
 assert len(matches)==1 and matches[0]['isAvailable'] is True and matches[0]['version']=='26.2' and 'arm64' in matches[0]['supportedArchitectures']
 assert any(x['identifier']==DEVICE_TYPE for x in matches[0]['supportedDeviceTypes'])
 for app in [BASE_APP,NEW_APP]:
  info=plistlib.loads((app/'Info.plist').read_bytes());assert info['CFBundleIdentifier']==APP and version_tuple(info['MinimumOSVersion'])<=version_tuple('26.2') and info['CFBundleSupportedPlatforms']==['iPhoneSimulator']

def stable_internal_headroom():
 for _ in range(3):
  space=os.statvfs('/private/tmp');assert space.f_bavail*space.f_frsize>=6*2**30
  time.sleep(1)

TEST_CASE='testOwnedCatalogPhase()'
def require_one_pass(summary):
 expected={'totalTestCount':1,'passedTests':1,'failedTests':0,'skippedTests':0,'expectedFailures':0}
 assert summary.get('result')=='Passed' and summary.get('testFailures')==[]
 for k,v in expected.items():assert type(summary.get(k)) is int and summary[k]==v

def passed_test_id(tree,device):
 leaves=[];runs=[]
 def visit(nodes):
  assert isinstance(nodes,list)
  for node in nodes:
   assert isinstance(node,dict)
   assert node.get('nodeType') not in ('Skip Message','Expected Failure')
   if node.get('nodeType')=='Test Case':leaves.append(node)
   if node.get('nodeType')=='Test Case Run':runs.append(node)
   visit(node.get('children',[]))
 visit(tree['testNodes']);assert len(leaves)==1
 assert len(runs)<=1 and all(run.get('result')=='Passed' for run in runs)
 case=leaves[0];assert case.get('result')=='Passed' and case.get('name')==TEST_CASE
 identifier=case.get('nodeIdentifier');assert identifier in ('Acceptance/'+TEST_CASE,'Acceptance/Acceptance/'+TEST_CASE)
 devices=tree['devices'];assert len(devices)==1 and devices[0]['deviceId']==device
 return identifier

def completion_attachment_name(value):
 if value=='blackcrab-phase-completion.json':return True
 # Observed xcresulttool 0.4.0 export spelling; the completion JSON, test,
 # device, nonfailure flag and uniqueness remain the authority for this receipt.
 return isinstance(value,str) and len(value)<=128 and re.fullmatch(r'blackcrab-phase-completion_[0-9]+_[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}\.json',value) is not None

def completion_receipt(manifest,root,test_id,phase,nonce,device):
 found=[];root=root.resolve(strict=True)
 assert isinstance(manifest,list)
 for test in manifest:
  assert test['testIdentifier']==test_id
  for a in test['attachments']:
   name=a['exportedFileName'];assert isinstance(name,str) and pathlib.Path(name).name==name and name not in ('.','..')
   path=root/name;assert not path.is_symlink() and path.resolve(strict=True).is_relative_to(root)
   if completion_attachment_name(a['suggestedHumanReadableName']):
    assert a['deviceId']==device and a['isAssociatedWithFailure'] is False
    value=json.loads(path.read_text());assert value=={'kind':'blackcrab-phase-completion-v1','phase':phase,'nonce':nonce,'deviceUUID':device}
    found.append(value)
 assert len(found)==1
 return found[0]

def host_inventory(root):
 rows=inventory(root)
 for r in rows:
  if r['kind']=='file':r['bytes']=(root/r['path']).lstat().st_size
 return rows

def copy_verified_host(source,destination):
 assert not destination.exists() and not destination.is_symlink()
 assert sha((source/'blackcrab-managed-host.json').read_bytes())==HOST_SHA
 before=host_inventory(source)
 shutil.copytree(source,destination,symlinks=True,copy_function=shutil.copy2)
 destination.chmod(0o700)
 assert host_inventory(source)==before and host_inventory(destination)==before
 assert sha((destination/'blackcrab-managed-host.json').read_bytes())==HOST_SHA
 return before

class Controller:
 def __init__(self,root):
  root=private(root);assert root.name=='Root-QA'
  marker=json.loads((root.parent/'OWNED-VOLUME.json').read_text());assert marker['task']=='blackcrab-c603-native-acceptance' and marker['uid']==os.getuid()
  self.root=pathlib.Path(tempfile.mkdtemp(prefix='xctest-private-',dir=root));self.root.chmod(0o700);self.n=0;self.children=[]
 def run(self,args,timeout=120,env=None):
  if getattr(self,'low',False):raise RuntimeError('Owned-device low-water stop latched')
  if min(os.statvfs(path).f_bavail*os.statvfs(path).f_frsize for path in ['/private/tmp',self.root])<2*2**30:raise RuntimeError('Owned-volume low-water precondition')
  self.n+=1;log=self.root/('raw-%03d.log'%self.n);fd=os.open(log,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
  try:
   with os.fdopen(fd,'wb') as f:
    safe={'PATH':'/usr/bin:/bin:/usr/sbin:/sbin','HOME':str(self.root),'TMPDIR':str(self.root),'LANG':'en_US.UTF-8','CLANG_MODULE_CACHE_PATH':str(self.root/'ModuleCache'),'SWIFT_MODULE_CACHE_PATH':str(self.root/'ModuleCache'),'GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null'}
    if env is not None:safe.update(env)
    child=subprocess.Popen(args,stdout=f,stderr=subprocess.STDOUT,env=safe,start_new_session=True);self.children.append(child)
    deadline=time.monotonic()+timeout
    try:
     while child.poll() is None:
      if args[:2]==['xcodebuild','test-without-building']:
       with log.open('rb') as observed:
        observed.seek(max(0,log.stat().st_size-1024*1024))
        if b"Test Case '-[Acceptance.Acceptance testOwnedCatalogPhase]' failed" in observed.read():
         raise RuntimeError('Owned UI test failed; stop captured test process')
      if time.monotonic()>=deadline:raise RuntimeError('Bounded private subprocess deadline')
      if min(os.statvfs(path).f_bavail*os.statvfs(path).f_frsize for path in ['/private/tmp',self.root])<2*2**30:raise RuntimeError('Owned-volume low-water subprocess stop')
      time.sleep(1)
     if child.returncode:raise RuntimeError('Private subprocess failed')
     return child.returncode
    except BaseException:
     if child.poll() is None:
      os.killpg(child.pid,signal.SIGTERM)
      try:child.wait(timeout=10)
      except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=10)
     raise
  except Exception:raise RuntimeError('Private phase failed; inspect private workspace') from None
 def watch(self,r):
  self.low=False;self.done=False
  def loop():
   while not self.done:
    if min(os.statvfs(path).f_bavail*os.statvfs(path).f_frsize for path in ['/private/tmp',self.root])<2*2**30:
     self.low=True
     try:subprocess.run(['xcrun','simctl','shutdown',r['uuid']],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30)
     except Exception:pass
     return
    time.sleep(2)
  self.watcher=threading.Thread(target=loop);self.watcher.start()
 def device(self,r):
  ds=json.loads(subprocess.check_output(['xcrun','simctl','list','devices','-j']));xs=[d for vs in ds['devices'].values() for d in vs if d['udid']==r['uuid']]
  assert len(xs)==1 and xs[0]['name']=='Blackcrab-47B65A5-'+r['nonce'] and xs[0]['deviceTypeIdentifier']=='com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro'
  assert xs[0]['dataPath']==r['dataPath'];return xs[0]
 def rpc(self,op,**kw):
  with socket.socket(socket.AF_UNIX) as s:
   s.settimeout(5 if op=='abort' else 20);s.connect(str(self.root/'native-acceptance.sock'));s.sendall((json.dumps(dict(op=op,**kw))+'\n').encode());b=b''
   while not b.endswith(b'\n'):
    assert op=='abort' or not getattr(self,'low',False)
    chunk=s.recv(4096)
    if not chunk:raise RuntimeError('Private fixture RPC closed before complete frame')
    b+=chunk;assert len(b)<32768
   x=json.loads(b);assert x['ok'];return x['result']
 def legacy(self,r):
  # Read only fixed keys belonging to THIS owned app, never real/user keychains.
  container=pathlib.Path(subprocess.check_output(['xcrun','simctl','get_app_container',r['uuid'],APP,'data'],text=True).strip())
  assert str(container).startswith(r['dataPath']+'/Containers/Data/Application/')
  db=pathlib.Path(r['dataPath'])/'Library/Keychains/keychain-2.db';rows=[]
  if db.exists():
   with sqlite3.connect('file:'+str(db)+'?mode=ro',uri=True) as c:
    for key in ['blackcrab.mobile.pairedHosts.v1','blackcrab.mobile.readCursors.v1']:
     vals=c.execute('SELECT agrp,acct,svce,data FROM genp WHERE (CAST(acct AS TEXT)=?) AND (agrp=? OR agrp LIKE ?)',(key,APP,'%.'+APP)).fetchall()
     rows.append((key,sha(repr(vals).encode())))
  q=container/'Documents/queue-recovery-v1';return {'keys':rows,'queues':inventory(q) if q.exists() else [],'queueDirectoryPresent':q.exists()}
 def test(self,r,phase,pair,certified):
  assert not self.low and self.device(r)['state']=='Booted'
  xfiles=list((self.root/'DerivedData/Build/Products').glob('*.xctestrun'));assert len(xfiles)==1
  data=rebase_runner_descriptor(plistlib.loads(xfiles[0].read_bytes()),xfiles[0].parent);found=0
  def patch(obj):
   nonlocal found
   if isinstance(obj,dict):
    if 'TestBundlePath' in obj:
     found+=1;obj.setdefault('EnvironmentVariables',{}).update({'BLACKCRAB_UI_USER_APPROVED':'YES','BLACKCRAB_PRIVATE_RAW_SINK_CERTIFIED':'YES' if certified else 'NO','BLACKCRAB_UI_INPUT':json.dumps({'nonce':r['nonce'],'expectedNonce':r['nonce'],'phase':phase,'ownedDeviceName':r['name'],'ownedDeviceUUID':r['uuid'],'sourceRevision':REV,'hostManifestSHA256':HOST_SHA,'address':pair['origin'],'pairingCode':pair['credential'],'initialTitle':'Blackcrab QA '+r['nonce'],'renamedTitle':'Blackcrab QA '+r['nonce']+' renamed'})})
    for v in obj.values():patch(v)
   elif isinstance(obj,list):
    for v in obj:patch(v)
  patch(data);assert found==1;p=self.root/(phase+'.xctestrun');p.write_bytes(plistlib.dumps(data));p.chmod(0o600)
  self.run(['xcodebuild','test-without-building','-xctestrun',str(p),'-destination','platform=iOS Simulator,id='+r['uuid'],'-only-testing:Acceptance/Acceptance/testOwnedCatalogPhase','-resultBundlePath',str(self.root/(phase+'.xcresult'))],timeout=1200)
  return self.verify_result(r,phase)
 def official_json(self,args,name):
  self.run(['xcrun','xcresulttool',*args],timeout=120)
  raw=self.root/('raw-%03d.log'%self.n);value=json.loads(raw.read_text());write(self.root/name,value);return value
 def verify_result(self,r,phase):
  result=self.root/(phase+'.xcresult')
  summary=self.official_json(['get','test-results','summary','--schema-version','0.4.0','--path',str(result)],phase+'-summary.private.json');require_one_pass(summary)
  tree=self.official_json(['get','test-results','tests','--schema-version','0.4.0','--path',str(result)],phase+'-tests.private.json');test_id=passed_test_id(tree,r['uuid'])
  activities=self.official_json(['get','test-results','activities','--schema-version','0.4.0','--path',str(result),'--test-id',test_id],phase+'-activities.private.json');assert activities
  exported=self.root/(phase+'-attachments');exported.mkdir(mode=0o700)
  self.run(['xcrun','xcresulttool','export','attachments','--schema-version','0.4.0','--path',str(result),'--test-id',test_id,'--output-path',str(exported)])
  manifest=exported/'manifest.json';assert manifest.is_file() and not manifest.is_symlink()
  receipt=completion_receipt(json.loads(manifest.read_text()),exported,test_id,phase,r['nonce'],r['uuid'])
  for parent,dirs,files in os.walk(exported,followlinks=False):
   for name in dirs+files:
    item=pathlib.Path(parent)/name;assert not item.is_symlink() and item.stat().st_uid==os.getuid();item.chmod(0o700 if item.is_dir() else 0o600)
  evidence={'summary':phase+'-summary.private.json','activities':phase+'-activities.private.json','attachments':exported.name,'phaseReceipt':receipt,'testIdentifier':test_id,'officialFileSha256':{name:sha((self.root/name).read_bytes()) for name in [phase+'-summary.private.json',phase+'-tests.private.json',phase+'-activities.private.json']},'exportInventory':inventory(exported)}
  write(self.root/(phase+'-official-evidence.private.json'),evidence);return evidence
 def stage_host(self):
  destination=self.root/'verified-proof9-host'
  records=copy_verified_host(HOST,destination)
  info=filesystem_info(destination);assert info['FilesystemType']=='apfs' and info['GlobalPermissionsEnabled'] is True
  assert all(p.lstat().st_uid==os.getuid() for p in destination.rglob('*') if not p.is_symlink())
  verifier=VALIDATION/'managed-host/artifact.mjs'
  pin=json.loads((HERE/'artifact-pins.json').read_text())['provenance']['current']
  source=json.loads(pathlib.Path(pin['manifest']).read_text());expected=next(i['sha256'] for i in source['inputs'] if i['path']=='managed-host/artifact.mjs');assert sha(verifier.read_bytes())==expected
  module=verifier.as_uri()
  code='import {verifyArtifact} from '+json.dumps(module)+';await verifyArtifact('+json.dumps(str(destination))+');'
  self.run([NODE,'--input-type=module','-e',code],timeout=600)
  assert host_inventory(destination)==records
  self.host_copy=destination;write(self.root/'host-copy.private.json',{'manifestSha256':HOST_SHA,'inventory':records,'producerVerifierPassed':True})
 def reuse_prebuilt_runner(self):
  pins=json.loads((HERE/'artifact-pins.json').read_text())
  for name,expected in pins['sources'].items():assert sha((HERE/name).read_bytes())==expected
  source,descriptor,app,binary=verify_prebuilt_runner(pins);verify_runtime_and_apps()
  self.run(['codesign','--verify','--deep','--strict',str(app)])
  assert subprocess.check_output(['lipo','-archs',str(binary)],text=True).strip()=='arm64'
  expected=inventory(source);destination=self.root/'DerivedData/Build/Products'
  destination.parent.mkdir(parents=True,mode=0o700);assert not destination.exists() and not destination.is_symlink()
  shutil.copytree(source,destination,symlinks=True,copy_function=shutil.copy2)
  assert inventory(source)==expected==inventory(destination)
  copied=destination/'Debug-iphonesimulator/Acceptance-Runner.app'
  self.run(['codesign','--verify','--deep','--strict',str(copied)])
  validate_runner_descriptor(plistlib.loads((destination/descriptor.name).read_bytes()),destination)
  write(self.root/'prebuilt-runner-reuse.json',{'reused':True,'compiled':False,'sourceRoot':str(PREBUILT_ROOT),'inventorySha256':pins['prebuiltRunner']['inventorySha256'],'executableSha256':PREBUILT_RUNNER_SHA,'runtime':RUNTIME,'deploymentMetadataCompatible':True})
 def build_runner(self):
  pins=json.loads((HERE/'artifact-pins.json').read_text())
  for name,expected in pins['sources'].items():assert sha((HERE/name).read_bytes())==expected
  assert os.statvfs('/private/tmp').f_bavail*os.statvfs('/private/tmp').f_frsize>=3*2**30
  self.run(['xcodebuild','build-for-testing','-project',str(HERE/'Acceptance.xcodeproj'),'-scheme','Acceptance','-destination','generic/platform=iOS Simulator','-derivedDataPath',str(self.root/'DerivedData'),'-jobs','2','ARCHS=arm64','CODE_SIGN_IDENTITY=-','DEVELOPMENT_TEAM='],timeout=1200)
  products=self.root/'DerivedData/Build/Products'
  descriptors=list(products.glob('*.xctestrun'));bundles=list(products.glob('*-iphonesimulator/*-Runner.app/PlugIns/Acceptance.xctest'))
  assert len(descriptors)==1 and len(bundles)==1
  info=plistlib.loads((bundles[0]/'Info.plist').read_bytes());assert info['CFBundleIdentifier']=='dev.blackcrab.acceptance.ui'
  binary=bundles[0]/info['CFBundleExecutable'];assert binary.is_file() and not binary.is_symlink()
  write(self.root/'runner-build-summary.json',{'buildForTestingPassed':True,'uiTestsExecuted':False,'simulatorBooted':False,'credentialsCreated':False,'xctestrun':str(descriptors[0]),'testBundle':str(bundles[0]),'testExecutable':str(binary),'executableSha256':sha(binary.read_bytes())})
 def installed(self,r,expected):
  self.device(r)
  p=pathlib.Path(subprocess.check_output(['xcrun','simctl','get_app_container',r['uuid'],APP,'app'],text=True).strip())
  assert str(p).startswith(r['dataPath']+'/Containers/Bundle/Application/')
  source=BASE_APP if expected==json.loads((HERE/'artifact-pins.json').read_text())['baseline'] else NEW_APP
  changes=verify_installed_bundle(source,p,expected,lambda app:self.run(['codesign','--verify','--deep','--strict',str(app)]))
  write(self.root/('installed-mode-policy-'+expected[:12]+'.json'),{'sourceInventorySha256':expected,'acceptedModeOnlyPaths':changes,'installedSignatureVerified':True})
 def execute(self,canary):
  pins=json.loads((HERE/'artifact-pins.json').read_text())
  for name,expected in pins['sources'].items():assert sha((HERE/name).read_bytes())==expected
  for key,receipt in pins['provenance'].items():
   report=pathlib.Path(receipt['report']);manifest=pathlib.Path(receipt['manifest']);assert sha(report.read_bytes())==receipt['reportSha256'] and sha(manifest.read_bytes())==receipt['manifestSha256']
   assert json.loads(manifest.read_text())['revision']==receipt['revision']
   assert json.loads(report.read_text())['status']=='built'
  for key,path in [('baseline',BASE_APP),('current',NEW_APP)]:
   assert sha(json.dumps(inventory(path),sort_keys=True).encode())==pins[key]
   assert sha((path/'main.jsbundle').read_bytes())==pins['provenance'][key]['hermesSha256']
   assert plistlib.loads((path/'Info.plist').read_bytes())['CFBundleIdentifier']==APP
   self.run(['codesign','--verify','--deep','--strict',str(path)])
  assert sha((HOST/'blackcrab-managed-host.json').read_bytes())==HOST_SHA
  if not canary:self.stage_host()
  self.reuse_prebuilt_runner() # Exact immutable runner; fail before any device on mismatch.
  stable_internal_headroom()
  nonce=str(uuid.uuid4());name='Blackcrab-47B65A5-'+nonce
  u=subprocess.check_output(['xcrun','simctl','create',name,DEVICE_TYPE,RUNTIME],text=True).strip()
  ds=json.loads(subprocess.check_output(['xcrun','simctl','list','devices','-j']));d=next(x for vs in ds['devices'].values() for x in vs if x['udid']==u);r={'uuid':u,'name':name,'nonce':nonce,'dataPath':d['dataPath']};write(self.root/'owned-device.json',r)
  try:
   self.device(r);self.watch(r);self.run(['xcrun','simctl','boot',u]);self.run(['xcrun','simctl','bootstatus',u,'-b'],timeout=240);assert not self.low
   bootlog=(self.root/('raw-%03d.log'%self.n)).read_text();assert 'Finished' in bootlog and 'Data Migration Failed' not in bootlog
   # Runner was verified/copied before device creation; never compile after boot.
   self.run(['xcrun','simctl','install',u,str(BASE_APP)]);self.installed(r,pins['baseline']);before=self.legacy(r)
   if canary:
    pair={'origin':'http://127.0.0.1:9/','credential':'23456789ABCD'}
    evidence=self.test(r,'logging-canary',pair,True)
    self.normalize_private()
    write(self.root/'canary-receipt.json',{'privateRawOnly':True,'noValueBearingExport':True,'reviewed':False,'sourceSha256':sha((HERE/'Acceptance.swift').read_bytes()),'officialEvidence':evidence,'officialEvidenceSha256':sha(json.dumps(evidence,sort_keys=True).encode())})
    return
   pair=self.start_fixture(r,canary)
   self.test(r,'seed-baseline',pair,True)
   # Successful Swift completion already includes app.terminate(). A second
   # simctl terminate returns ESRCH and must not prevent the upgrade phase.
   after=self.legacy(r)
   write(self.root/'post-baseline-storage-check.private.json',{'keysUnchanged':after['keys']==before['keys'],'queuesUnchanged':after['queues']==before['queues'],'queueDirectoryPresenceUnchanged':after['queueDirectoryPresent']==before['queueDirectoryPresent']})
   assert after==before
   initial=self.rpc('status');assert initial['runs']==0 and initial['providerSessions']==0
   self.run(['xcrun','simctl','install',u,str(NEW_APP)]);self.installed(r,pins['current']) # Deliberately never uninstall.
   assert self.legacy(r)==before
   self.test(r,'control-upgraded',pair,True)
   self.rpc('expectNative',title='Blackcrab QA '+nonce+' renamed',archived=True)
   assert self.legacy(r)==before;final=self.rpc('finish');assert final['runs']==0 and final['providerSessions']==0
   self.fixture.wait(timeout=30);assert self.fixture.returncode==0 and not self.low
   # Publish only fixed booleans/counts after disposable host was stopped.
   self.sanitize(pair)
   write(self.root/'sanitized-summary.json',{'passed':True,'os':'26.2','source':REV,'zeroRuns':True,'zeroProviderSessions':True,'legacyDigestsUnchanged':True,'legacyQueueInitiallyEmpty':not before['queues'],'mode':'canary' if canary else 'owned-credential'})
  finally:
   self.done=True
   if hasattr(self,'watcher'):self.watcher.join(timeout=5)
   cleanup_error=None
   try:self.cleanup_fixture()
   except Exception as error:cleanup_error=error
   self.normalize_private()
   try:self.run(['xcrun','simctl','shutdown',u])
   except Exception:pass
   if cleanup_error:raise cleanup_error
 def normalize_private(self):
  for parent,dirs,files in os.walk(self.root,followlinks=False):
   for name in dirs+files:
    p=pathlib.Path(parent)/name
    if p.is_symlink():continue
    assert p.stat().st_uid==os.getuid()
    p.chmod(0o700 if p.is_dir() else 0o600)
 def start_fixture(self,r,canary):
  # Canary uses the same private sinks and a real fixture grant; publish nothing
  # value-bearing. Approval must explicitly cover the owned fixture credential.
  target=VALIDATION/('apps/mobile/.generated/ios-acceptance-'+r['nonce']);assert not target.exists();target.mkdir(mode=0o700)
  self.fixture_target=target
  source=(HERE/'observer.test.ts.template').read_text().replace('from "../../src/managed/','from "../../src/managed/')
  (target/'observer.test.ts').write_text(source)
  assert self.host_copy.parent==self.root and self.host_copy.name=='verified-proof9-host'
  helper=(HERE/'packaged-host.mjs.template').read_text().replace('__ARTIFACT_MODULE__',(VALIDATION/'managed-host/artifact.mjs').as_uri()).replace('__VERIFIED_HOST_COPY__',json.dumps(str(self.host_copy)));(target/'packaged-host.mjs').write_text(helper)
  (target/'tsconfig.json').write_text('{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"bundler"}}')
  config='import {defineConfig} from "vitest/config";export default defineConfig({tsconfig:'+json.dumps(str(target/'tsconfig.json'))+',test:{environment:"node",maxWorkers:1,include:['+json.dumps(str(target/'observer.test.ts'))+']},server:{fs:{allow:['+json.dumps(str(self.root))+','+json.dumps(str(VALIDATION))+']}}});'
  (target/'vitest.config.mts').write_text(config)
  env={'PATH':str(pathlib.Path(NODE).parent)+':/usr/bin:/bin','HOME':str(self.root),'TMPDIR':str(self.root),'NODE_ENV':'test','BLACKCRAB_QA_WORKDIR':str(self.root),'BLACKCRAB_QA_NONCE':r['nonce']}
  log=os.open(self.root/'raw-sdk.log',os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
  self.fixture=subprocess.Popen([NODE,str(VALIDATION/'node_modules/vitest/vitest.mjs'),'run','--config',str(target/'vitest.config.mts')],cwd=VALIDATION/'apps/mobile',env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);os.close(log)
  p=self.root/'native-pairing.private.json';deadline=time.time()+600
  while not p.exists():
   assert self.fixture.poll() is None and time.time()<deadline and not self.low;time.sleep(1)
  pair=json.loads(p.read_text());assert re.fullmatch('[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}',pair['credential']);return pair
 def cleanup_fixture(self):
  import signal
  fixture_error=None
  if hasattr(self,'fixture') and self.fixture.poll() is None:
   # Ask the still-live owner to close its actual host Child before interrupting
   # Vitest. A framework signal alone can exit the worker before its finally.
   try:
    self.rpc('abort')
    self.fixture.wait(timeout=30)
   except Exception:pass
   if self.fixture.poll() is None:
    os.killpg(self.fixture.pid,signal.SIGINT)
    try:self.fixture.wait(timeout=30)
    except subprocess.TimeoutExpired:
     if self.fixture.poll() is None:os.killpg(self.fixture.pid,signal.SIGTERM)
     try:self.fixture.wait(timeout=15)
     except subprocess.TimeoutExpired:fixture_error=RuntimeError('Captured fixture group did not exit; publish no report')
  report=self.root/'artifacts/native-ui-control-report.json'
  capture=self.root/'captured-host.private.json'
  if capture.exists():
   c=json.loads(capture.read_text())
   # This receipt is an observation, never process-control authority. Only the
   # live fixture retains the actual host Child and may stop it. Even matching
   # PID/start/group/path fields cannot restore a lost process handle.
   if c.get('closed') is not True:
    raise RuntimeError('Host cleanup uncertain; retain private evidence and publish no report')
  elif hasattr(self,'fixture'):
   raise RuntimeError('Host closure observation missing; publish no report')
  if report.exists():assert json.loads(report.read_text()).get('hostClosed') is True
  if fixture_error:raise fixture_error
 def sanitize(self,pair):
  # Never export raw xcresults or logs. Private report only; exact token/URL
  # replacements are defense in depth for any later reviewed textual export.
  report=json.loads((self.root/'artifacts/native-ui-control-report.json').read_text());assert report['hostClosed'] is True
  secrets=[pair['credential'],pair['origin']+'pair#token='+pair['credential']]
  assert all(secrets)
  write(self.root/'redaction-policy.json',{'rawExportAllowed':False,'sdkHostClosed':True,'sensitiveValuesOmitted':True})
def main():
 a=argparse.ArgumentParser();a.add_argument('--workspace',type=pathlib.Path,required=True);a.add_argument('--user-approved-xctest-and-owned-credential',action='store_true');a.add_argument('--certification-canary',action='store_true');a.add_argument('--runner-build-only',action='store_true');a.add_argument('--certified-redaction-receipt',type=pathlib.Path);o=a.parse_args()
 if o.runner_build_only:
  os.umask(0o077);Controller(o.workspace).build_runner();return
 assert o.user_approved_xctest_and_owned_credential,'Explicit user approval required'
 if not o.certification_canary:
  assert o.certified_redaction_receipt and o.certified_redaction_receipt.resolve().is_relative_to(o.workspace.resolve())
  receipt=json.loads(o.certified_redaction_receipt.read_text());assert receipt.get('privateRawOnly') is True and receipt.get('noValueBearingExport') is True and receipt.get('reviewed') is True and receipt.get('sourceSha256')==sha((HERE/'Acceptance.swift').read_bytes())
  evidence=receipt['officialEvidence'];assert receipt['officialEvidenceSha256']==sha(json.dumps(evidence,sort_keys=True).encode())
  assert evidence['summary']=='logging-canary-summary.private.json' and evidence['activities']=='logging-canary-activities.private.json' and evidence['attachments']=='logging-canary-attachments'
  assert set(evidence['officialFileSha256'])=={'logging-canary-summary.private.json','logging-canary-tests.private.json','logging-canary-activities.private.json'}
  evidence_root=o.certified_redaction_receipt.resolve().parent
  assert evidence['phaseReceipt']['phase']=='logging-canary'
  for name,h in evidence['officialFileSha256'].items():
   assert pathlib.Path(name).name==name and sha((evidence_root/name).read_bytes())==h
  require_one_pass(json.loads((evidence_root/evidence['summary']).read_text()))
  assert json.loads((evidence_root/evidence['activities']).read_text())
  assert pathlib.Path(evidence['attachments']).name==evidence['attachments']
  attachments=evidence_root/evidence['attachments'];assert inventory(attachments)==evidence['exportInventory']
  completed=evidence['phaseReceipt'];uuid.UUID(completed['nonce']);uuid.UUID(completed['deviceUUID'])
  assert passed_test_id(json.loads((evidence_root/'logging-canary-tests.private.json').read_text()),completed['deviceUUID'])==evidence['testIdentifier']
  assert completion_receipt(json.loads((attachments/'manifest.json').read_text()),attachments,evidence['testIdentifier'],'logging-canary',completed['nonce'],completed['deviceUUID'])==completed
 os.umask(0o077);c=Controller(o.workspace);(c.root/'artifacts').mkdir(mode=0o700);c.execute(o.certification_canary)
if __name__=='__main__':
 try:main()
 except BaseException:raise SystemExit('Acceptance stopped; private evidence retained. No raw values exported.') from None
