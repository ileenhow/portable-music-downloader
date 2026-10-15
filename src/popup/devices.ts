export interface RemovableDevice { id: string; name: string; capacity: number; availableCapacity?: number }
export interface DeviceSnapshot { devices: RemovableDevice[]; status: 'loading'|'ready'|'unavailable' }

// Storage discovery never opens, claims or writes a USB interface.
export class DeviceDiscovery {
  private api=globalThis.chrome?.system?.storage;
  private revision=0;
  private started=false;
  private snapshot: DeviceSnapshot={devices:[],status:'loading'};

  constructor(private changed: (snapshot: DeviceSnapshot)=>void){}

  private publish(devices: RemovableDevice[],status: DeviceSnapshot['status']){
    this.snapshot={devices:[...devices].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')),status};
    this.changed(this.snapshot);
  }

  private attached=(info: chrome.system.storage.StorageUnitInfo)=>{
    if(info.type!=='removable')return;
    ++this.revision;
    this.publish(this.snapshot.devices.filter(device=>device.id!==info.id).concat(this.device(info)),'ready');
    void this.refresh();
  };

  private detached=(id: string)=>{
    ++this.revision;
    this.publish(this.snapshot.devices.filter(device=>device.id!==id),'ready');
    void this.refresh();
  };

  private device(info: chrome.system.storage.StorageUnitInfo): RemovableDevice {
    return {id:info.id,name:info.name.trim()||'可移动设备',capacity:info.capacity};
  }

  start(){
    if(this.started)return;
    this.started=true;
    this.api?.onAttached.addListener(this.attached);
    this.api?.onDetached.addListener(this.detached);
    void this.refresh();
  }

  async refresh(){
    const revision=++this.revision;
    if(!this.api){this.publish(this.snapshot.devices,'unavailable');return;}
    try{
      const devices=(await this.api.getInfo()).filter(info=>info.type==='removable').map(info=>this.device(info));
      // This API is optional (Dev channel); absence must not prevent device discovery.
      if(typeof this.api.getAvailableCapacity==='function')await Promise.all(devices.map(async device=>{
        try{
          const result=await this.api!.getAvailableCapacity(device.id);
          if(Number.isFinite(result.availableCapacity)&&result.availableCapacity>=0&&result.availableCapacity<=device.capacity)device.availableCapacity=result.availableCapacity;
        }catch{/* Fall back to scanned MP3 sizes on stable browsers or disconnected media. */}
      }));
      if(revision===this.revision)this.publish(devices,'ready');
    }catch{
      if(revision===this.revision)this.publish(this.snapshot.devices,'unavailable');
    }
  }

  stop(){
    ++this.revision;
    this.api?.onAttached.removeListener(this.attached);
    this.api?.onDetached.removeListener(this.detached);
    this.started=false;
  }
}
