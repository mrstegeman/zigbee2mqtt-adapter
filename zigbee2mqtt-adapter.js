/**
 * zigbee2mqtt-adapter.js - Adapter to use all those zigbee devices via
 * zigbee2mqtt.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.*
 */

'use strict';

const {spawn, execSync, execFile} = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

const mqtt = require('mqtt');
const {Adapter, Device, Property, Event} = require('gateway-addon');
const Zigbee2MQTTHandler = require('./api-handler');

const SerialPort = require('serialport');

const Devices = require('./devices');
const ExposesDeviceGenerator = require('./ExposesDeviceGenerator');
//const colorTranslator = require('./colorTranslator');

const identity = (v) => v;


class ZigbeeMqttAdapter extends Adapter {
  constructor(addonManager, manifest) {
    //
    // STARTING THE ADDON
    //

    super(addonManager, 'ZigbeeMqttAdapter', manifest.name);
    this.config = manifest.moziot.config;
    if (this.config.debug) {
			console.log("Debugging is enabled");
      console.log(this.config);
    }
    addonManager.addAdapter(this);
    this.exposesDeviceGenerator = new ExposesDeviceGenerator(this,this.config);

    this.client = mqtt.connect(this.config.mqtt);
    this.client.on('error', (error) => console.error('mqtt error', error));
    this.client.on('message', this.handleIncomingMessage.bind(this));
    this.client.subscribe(`${this.config.prefix}/bridge/devices`);
		this.client.subscribe(`${this.config.prefix}/bridge/response/networkmap`);

		//this.client.subscribe(`${this.config.prefix}/#`);

    // configuration file location
    this.zigbee2mqtt_data_dir_path =
      path.join(path.resolve('../..'), '.webthings','data', 'zigbee2mqtt-adapter');
    if(this.config.debug){
			console.log("this.zigbee2mqtt_data_dir_path =", this.zigbee2mqtt_data_dir_path);
		}

    // actual zigbee2mqt location
    this.zigbee2mqtt_dir_path = path.join(this.zigbee2mqtt_data_dir_path, 'zigbee2mqtt');

    // index.js file to be started by node
    this.zigbee2mqtt_file_path = path.join(this.zigbee2mqtt_dir_path, 'index.js');
    // console.log("this.zigbee2mqtt_dir_path =", this.zigbee2mqtt_dir_path);

    // should be copied at the first installation
    this.zigbee2mqtt_configuration_file_source_path =
      path.join(this.zigbee2mqtt_dir_path, 'data', 'configuration.yaml');
    this.zigbee2mqtt_configuration_file_path =
      path.join(this.zigbee2mqtt_data_dir_path, 'configuration.yaml');
    // console.log("this.zigbee2mqtt_configuration_file_path =",
    //             this.zigbee2mqtt_configuration_file_path);

    this.zigbee2mqtt_configuration_devices_file_path =
      path.join(this.zigbee2mqtt_data_dir_path, 'devices.yaml');
    this.zigbee2mqtt_configuration_groups_file_path =
      path.join(this.zigbee2mqtt_data_dir_path, 'groups.yaml');
    // console.log("this.zigbee2mqtt_configuration_devices_file_path =",
    //             this.zigbee2mqtt_configuration_devices_file_path);

    this.zigbee2mqtt_package_file_path =
      path.join(this.zigbee2mqtt_data_dir_path, 'zigbee2mqtt', 'package.json');
    // console.log("this.zigbee2mqtt_package_file_path =", this.zigbee2mqtt_package_file_path);

    this.zigbee2mqtt_configuration_log_path = path.join(this.zigbee2mqtt_data_dir_path, 'log');
    // console.log("this.zigbee2mqtt_configuration_log_path =",
    //             this.zigbee2mqtt_configuration_log_path);

		// 


		this.devices_overview = {};//new Map(); // stores all the connected devices, and if they can be updated. Could potentially also be used to force-remove devices from the network.


		// Allow UI to connect
		try{
	    this.apiHandler = new Zigbee2MQTTHandler(
	      addonManager,
	      this,
	      this.config
	    );
		}
		catch (error){
			console.log("Error loading api handler: " + error)
		}


    //
    // CHECK IF ZIGBEE2MQTT SHOULD BE INSTALLED OR UPDATED
    //
		if(this.config.debug){
			console.log("this.config.local_zigbee2mqtt = " + this.config.local_zigbee2mqtt);
		}
		if(this.config.local_zigbee2mqtt == true){
			
	    fs.access(this.zigbee2mqtt_dir_path, (err) => {
	      // fs.access(this.zigbee2mqtt_dir_path, function(err) {
	      if (err && err.code === 'ENOENT') {
	        this.download_z2m();
	      } else {
	        if(this.config.debug){
						console.log('zigbee2mqtt folder existed.');
					}

	        if (this.config.auto_update) {
	          console.log('Auto-update is enabled. Checking if zigbee2mqtt should be updated...');
	          // downloads json from https://api.github.com/repos/Koenkk/zigbee2mqtt/releases/latest;

	          try {
	            const options = {
	              hostname: 'api.github.com',
	              port: 443,
	              path: '/repos/Koenkk/zigbee2mqtt/releases/latest',
	              method: 'GET',
	              headers: {
	                'X-Forwarded-For': 'xxx',
	                'User-Agent': 'Node',
	              },
	            };

	            const req = https.request(options, (res) => {
	              if(this.config.debug){
									console.log('statusCode:', res.statusCode);
								}
	              // console.log('headers:', res.headers);

	              let body = '';
	              res.on('data', (chunk) => {
	                body += chunk;
	              });

	              res.on('end', () => {
	                try {
	                  // console.log("parsing...");
	                  // console.log(body);
	                  const github_json = JSON.parse(body);
										if(this.config.debug){
	                  	console.log('latest zigbee2MQTT version found on Github =', github_json.tag_name);
										}

	                  fs.readFile(this.zigbee2mqtt_package_file_path, 'utf8', (err, data) => {
	                    if (err) {
	                      console.log(`Error reading file from disk: ${err}`);
	                    } else {
	                      // parse JSON string to JSON object
	                      const z2m_package_json = JSON.parse(data);
	                      if(this.config.debug){
													console.log(`local zigbee2MQTT version = ${z2m_package_json.version}`);
												}

	                      if (github_json.tag_name == z2m_package_json.version) {
	                        if(this.config.debug){
														console.log('zigbee2mqtt versions are the same, no need to update zigbee2mqtt');
													}
	                        this.check_if_config_file_exists(this);
	                      } else {
	                        console.log('a new official release of zigbee2mqtt is available.',
	                                    'Will attempt to upgrade.');
	                        // console.log("tarball_url to download = " + github_json['tarball_url']);
													
													this.sendPairingPrompt("Updating Zigbee2MQTT to " + github_json.tag_name);
													
	                        this.delete_z2m();
	                        this.download_z2m();
	                      }
	                    }
	                  });

	                  // TODO: do something with JSON
	                  // const json = JSON.parse(body);
	                } catch (error) {
	                  console.error(error.message);
	                }
	              });
	            });

	            req.on('error', (e) => {
	              console.error(e);
	            });
	            req.end();
	          } catch (error) {
	            console.error(error.message);
	          }
	        } else {
	          this.check_if_config_file_exists();
	        }
	      }
	    }); // end of fs.access check
			
		}
		else{
			console.log("Not using built-in zigbee2mqtt");
		}
    
  }


  // By having the config files outside of the zigbee2mqtt folder it becomes easier to update
  // zigbee2mqtt
  check_if_config_file_exists() {
    try {
      if(this.config.debug){
				console.log('Checking if config file exists');
			}

      fs.access(this.zigbee2mqtt_configuration_file_source_path, (err) => {
        // fs.access(this.zigbee2mqtt_configuration_file_source_path, function(err) {
        if (err && err.code === 'ENOENT') {
          console.log('The configuration.yaml source file doesn\'t exist:',
                      this.zigbee2mqtt_configuration_file_source_path);
        } else {
          console.log('configuration.yaml source file existed');
          fs.access(this.zigbee2mqtt_configuration_file_path, (err) => {
            // fs.access(this.zigbee2mqtt_configuration_file_path, function(err) {
            if (err && err.code === 'ENOENT') {
              console.log('data dir configuration.yaml file doesn\'t exist yet',
                          `(${this.zigbee2mqtt_configuration_file_path}).`,
                          'It should be copied over.');
              fs.copyFile(
                this.zigbee2mqtt_configuration_file_source_path,
                this.zigbee2mqtt_configuration_file_path,
                (err) => {
                  if (err) {
                    throw err;
                  }
                  console.log('configuration yaml file was copied to the correct location.');
                  this.run_zigbee2mqtt();
                }
              );
            } else {
              console.log('configuration.yaml file existed.');
              this.run_zigbee2mqtt();
            }
          });
        }
      });
    } catch (error) {
      console.error(`Error checking if zigbee2mqtt config file exists: ${error.message}`);
    }
  }



  stop_zigbee2mqtt() {
    try {
      this.zigbee2mqtt_subprocess.kill();
    } catch (error) {
      console.error(`Error stopping zigbee2mqtt: ${error.message}`);
    }
  }



  run_zigbee2mqtt() {
    if(this.config.debug){
			console.log('starting zigbee2MQTT using: node ' + this.zigbee2mqtt_file_path);
 	  	console.log("initial this.config.serial_port = " + this.config.serial_port);
		}
 	 	this.selected_serial_port = this.config.serial_port;
		
 
 	 	var ama_candidate = null;
		var pnpid_candidate = null;
 
 	 
		// auto-scan serial ports:
		if(typeof this.config.serial_port == "undefined"){
			
			if(this.config.debug){
				console.log("doing serial port scan");
			}
			try{
			
				/*
				SerialPort.on('close', function (err) {
				    console.log('port closed', err);  
				});
				*/
			
				SerialPort.list().then(ports => {
					if(this.config.debug){
						console.log("serial ports:");
						console.log(ports);
					}

				  //if(this.selected_serial_port == "" || typeof this.selected_serial_port == "undefined"){
						ports.forEach(function(port) {
							if(this.config.debug){
								console.log("__");
						    console.log(port.path);
						    console.log(port.pnpId);
						    console.log(port.manufacturer);
							}
							if(typeof port.path == "string"){
								if(port.path.startsWith("/dev/ttyAMA") && ama_candidate == null){
									ama_candidate = port.path;
								}
							}
						
							if(typeof port.pnpId == "string"){
								if( port.pnpId.includes("CC253") ){
									if(typeof port.path == 'string'){
										console.log("CC253 SPOTTED");
										ama_candidate = port.path;
									}
								}
								if( port.pnpId.includes("if00") ){
									if(typeof port.path == 'string'){
										console.log("CC26X2R1 SPOTTED");
										ama_candidate = port.path;
									}
								}
								/*
								if( port.pnpId.includes("igbee") ){
									pnpid_candidate = port.pnpId;
								}
								if( port.pnpId.includes("onbee") ){
									pnpid_candidate = port.pnpId;
								}*/
							}
					  });
						if(this.config.debug){
							console.log("pnpid_candidate = " + pnpid_candidate);
							console.log("ama_candidate = " + ama_candidate);
						}
						/*
						if(pnpid_candidate != null){
							this.selected_serial_port = "/dev/serial/by-id/" + pnpid_candidate;
						}
						*/
						if(ama_candidate != null){
							this.selected_serial_port = ama_candidate
						}
						else{
							this.sendPairingPrompt("No USB stick detected");
							console.error("ERROR: No Zigbee USB stick detected. If this is wrong, then you can force this addons to select a specific USB port in the addon settings.");
							return;
						}
					//}
				
					//console.log("this.selected_serial_port = " + this.selected_serial_port);



			    try {
						/*
						SerialPort.close(function (err) {
						    console.log('port closed', err);
						});
						*/
					
				    this.really_run_zigbee();
					
						/*
			      this.zigbee2mqtt_subprocess = execFile(
			        'node',
			        [this.zigbee2mqtt_file_path],
			        (error, stdout, stderr) => {
			          if (error) {
			            console.log(`error: ${error.message}`);
			            return;
			          }
			          if (stderr) {
			            console.log(`stderr: ${stderr}`);
			            return;
			          }
			          console.log(`stdout: ${stdout}`);
			        }
			      );
						*/
						
			    } catch (error) {
			      console.error(`Error starting zigbee2mqtt: ${error.message}`);
			    }
				
				
				});
			}
			catch (error) {
				console.error(error);
				this.selected_serial_port = "/dev/ttyAMA0";
			}
			
		}
		else{
			console.log("selected_serial_port = " + this.selected_serial_port);
			/*
	    process.env.ZIGBEE2MQTT_DATA = this.zigbee2mqtt_data_dir_path;
			process.env.ZIGBEE2MQTT_CONFIG_MQTT_BASE_TOPIC = this.config.prefix;
			process.env.ZIGBEE2MQTT_CONFIG_MQTT_SERVER = this.config.mqtt;
			process.env.ZIGBEE2MQTT_CONFIG_SERIAL_PORT = this.config.serial_port;
			process.env.ZIGBEE2MQTT_CONFIG_ADVANCED_LOG_DIRECTORY = this.zigbee2mqtt_configuration_log_path;
			process.env.ZIGBEE2MQTT_CONFIG_ADVANCED_LOG_FILE = '%TIMESTAMP%.txt';
			process.env.ZIGBEE2MQTT_CONFIG_ADVANCED_LOG_LEVEL = 'debug';
			*/

	    try {
				/*
				SerialPort.close(function (err) {
				    console.log('port closed', err);
				});
				*/
				
		    this.really_run_zigbee();
				
				/*
	      this.zigbee2mqtt_subprocess = execFile(
	        'node',
	        [this.zigbee2mqtt_file_path],
	        (error, stdout, stderr) => {
	          if (error) {
	            console.log(`error: ${error.message}`);
	            return;
	          }
	          if (stderr) {
	            console.log(`stderr: ${stderr}`);
	            return;
	          }
	          console.log(`stdout: ${stdout}`);
	        }
	      );
				*/
					
	    } catch (error) {
	      console.error(`Error starting zigbee2mqtt: ${error.message}`);
	    }
		}
		
	
  }


	really_run_zigbee(){
		if(this.config.debug){
			console.log("this.selected_serial_port = " + this.selected_serial_port);
			console.log("this.zigbee2mqtt_configuration_devices_file_path = " + this.zigbee2mqtt_configuration_devices_file_path);
			console.log("this.zigbee2mqtt_configuration_log_path = " + this.zigbee2mqtt_configuration_log_path);
		}
    process.env.ZIGBEE2MQTT_DATA = this.zigbee2mqtt_data_dir_path;
		process.env.ZIGBEE2MQTT_CONFIG_MQTT_BASE_TOPIC = this.config.prefix;
		process.env.ZIGBEE2MQTT_CONFIG_MQTT_SERVER = this.config.mqtt;
		process.env.ZIGBEE2MQTT_CONFIG_SERIAL_PORT = this.selected_serial_port;
		process.env.ZIGBEE2MQTT_CONFIG_ADVANCED_LOG_DIRECTORY = this.zigbee2mqtt_configuration_log_path;
		process.env.ZIGBEE2MQTT_CONFIG_ADVANCED_LOG_FILE = '%TIMESTAMP%.txt';
		
		if(this.config.debug){
			process.env.ZIGBEE2MQTT_CONFIG_ADVANCED_LOG_LEVEL = 'debug';
		}
		
		process.env.ZIGBEE2MQTT_CONFIG_ADVANCED_CHANNEL = this.config.channel;

		//process.env.ZIGBEE2MQTT_CONFIG_DEVICES = this.zigbee2mqtt_configuration_devices_file_path;
		//process.env.ZIGBEE2MQTT_CONFIG_GROUPS = this.zigbee2mqtt_configuration_groups_file_path;
		if(this.config.debug){
  		this.zigbee2mqtt_subprocess = spawn('node', [this.zigbee2mqtt_file_path],
  			{stdio: [process.stdin, process.stdout, process.stderr]});
		}
		else{
  		this.zigbee2mqtt_subprocess = spawn('node', [this.zigbee2mqtt_file_path],
  			{stdio: ['ignore', 'ignore', process.stderr] });
		}
		
		
		
	}



  download_z2m() {
		
    console.log('Downloading Zigbee2MQTT');
    
		try {
      execSync(
        `git clone --depth=1 https://github.com/Koenkk/zigbee2mqtt ${this.zigbee2mqtt_dir_path}`
      );
    } catch (error) {
      console.error('Error downloading:', error);
      return;
    }

    console.log('Installing Zigbee2MQTT. This may take up to 10 minutes.');
    try {
      execSync(`cd ${this.zigbee2mqtt_dir_path}; npm ci --production`);
    } catch (error) {
      console.error('Error installing:', error);
    }
	
		this.sendPairingPrompt("Ready!");
	
  }


  delete_z2m() {
	    if(this.config.debug){
				console.log('Attempting to delete local zigbee2mqtt from data folder');
			}
	    try {
	      execSync(`rm -rf ${this.zigbee2mqtt_dir_path}`);
				return true;
	    } catch (error) {
	      console.error('Error deleting:', error);
				return false;
	    }
			return false;
	}



  handleIncomingMessage(topic, data) {
		if(this.config.debug){
			console.log('');
			console.log('_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ * * *');
    	console.log('in incoming message, topic: ' + topic);
			console.log(this.config.prefix);
		}
		if (topic.trim() == this.config.prefix + '/bridge/logging') { 
			//console.log("ignoring logging");
			return;
		}
		
		if( !data.toString().includes(":") ){
			//console.log("incoming message did not have a : in it? aborting processing it.");
			return;
		}
		
		var msg = JSON.parse(data.toString());
   
		if (topic.trim() == this.config.prefix + '/bridge/devices' ) { 
			if(this.config.debug){
				console.log("/bridge/devices detected");
			}
			
			try{
		      for (const device of msg) {
		        this.addDevice(device);
		      }
			}
			catch (error){
				console.log("Error parsing /bridge/devices: " + error);
			}
			
		}	
	
		
	
		// if it's not an 'internal' message, it must be a message with information about properties
    if (!topic.startsWith(this.config.prefix + '/bridge')) {
			try{
	      const friendlyName = topic.replace(this.config.prefix + '/', ''); // extract the target device ID
				if(this.config.debug){
					console.log("- friendlyName = " + friendlyName);
				}
	      const device = this.getDevice(friendlyName); // try to get the device
	      if (!device) {
					if(this.config.debug){
						console.log("- strange, that device could not be found: " + friendlyName);
					}
	        return;
	      }
	      if (msg.action && device.events.get(msg.action)) { // if there's an action (event), and the action exists in the device
	        const event = new Event(
	          device,
	          msg.action,
	          msg[device.events.get(msg.action)],
	        );
	        device.eventNotify(event);
	      }
	      for (const key of Object.keys(msg)) { // loop over actual property updates
	        const property = device.findProperty(key);
	        if (!property) {
						if(this.config.debug){
							console.log("- strange, that property could not be found: " + key);
						}
						if(key != "update" && typeof msg[key] != "object"){ // && key != "update_available"
							if(this.config.debug){
								console.log("- attempting to create missing property");
							}
							this.attempt_new_property(friendlyName,key,msg[key]);
						}else{
							if(this.config.debug){
								console.log("- ignoring update property");
							}
						}
	          continue;
	        }
				
					//console.log("updating this property:");
					//console.log(property);
					
					// Check if device can be updated
					if(key == 'update_available'){
						//console.log("found update_available information, storing in device_overview.");
						this.devices_overview[friendlyName]['update_available'] = msg[key];
					}
					
					
					
					// Attempt to make a color compatible with the gateway's HEX color system
					try{
						if(key == 'color' && typeof msg[key] == "object"){
							if(this.config.debug){
								console.log("- translating color to hex");
							}
							var brightness = 254;
							if('brightness' in msg){
								brightness = msg['brightness'];
							}
							if(Object.keys(msg[key]).length == 2){
								msg[key] = XYtoHEX( msg[key]['x'], msg[key]['y'], brightness); // turn x+y coordinates into hex color
							}
						}
					}
					catch (error){
						console.log(error);
						continue;
					}
					
					
					// Modify byte to a percentage
					try{
						if( property.options.hasOwnProperty("origin") ){
							
							if(property.options.origin == "exposes-scaled-percentage"){
								if(this.config.debug){
									console.log("- translating byte to percentage");
								}
								msg[key] = integer_to_percentage(msg['brightness'], property.options.origin_maximum);
							}
						}
					}
					catch (error){
						console.log(error);
						continue;
					}
					
					
					// Check if an extra boolean property should be updated
					try{
						if(key == 'action'){
							//console.log("key == action");
							if(	!msg.hasOwnProperty('state') ){
	
								if( msg[key].toLowerCase() == "on" || msg[key].toLowerCase() == "off"){
									//console.log("it's on or off");
					        const extra_property = device.findProperty('power state');
					        if (!extra_property) {
										//console.log("no extra power state property spotted");
									}
									else{
										var extra_boolean = false;
										if( msg[key].toLowerCase() == "on"){ extra_boolean = true }
						        const {extra_fromMqtt = identity} = extra_property.options;
						        extra_property.setCachedValue(extra_fromMqtt(extra_boolean));
						        device.notifyPropertyChanged(extra_property);
										if(this.config.debug){
											console.log("extra_boolean updated");
										}
									}
								}
								
							}
						}
					}
					catch (error){
						console.log("Error while trying to extract extra power state property: " + error);
					}
					
					if(this.config.debug){
						console.log(key + " -> ");
						console.log(msg[key]);
					}
	        const {fromMqtt = identity} = property.options;
	        property.setCachedValue(fromMqtt(msg[key]));
	        device.notifyPropertyChanged(property);
	      }
			}
      catch (error){
      	console.log(error);
      }
    }
		
		
		// Special case: handle incoming network map data
		if (topic.endsWith('/bridge/response/networkmap')) {
			this.apiHandler.map = msg['data']['value']; //'digraph G { "Welcome" -> "To" "To" -> "Privacy" "To" -> "ZIGBEE!"}';
			this.waiting_for_map = false;
		}
		
  }



  publishMessage(topic, msg) {
		if(this.config.debug){
	    console.log('in pubmsg. Topic & message: ' + topic);
			console.log(msg);
		}
    this.client.publish(`${this.config.prefix}/${topic}`, JSON.stringify(msg));
  }



  addDevice(info) {
    try{
			if(this.config.debug){
				console.log('in addDevice');
				//console.log(info);
				console.log("subscribing to: " + this.config.prefix + "/" + info.friendly_name);
			}
	    this.client.subscribe(`${this.config.prefix}/${info.friendly_name}`);
			//this.client.subscribe(this.config.prefix + "/" + info.friendly_name);
			
			if(	info.hasOwnProperty('model_id') &&  !this.devices_overview.hasOwnProperty(info.friendly_name) ){
				this.devices_overview[info.friendly_name] = {'friendly_name':info.friendly_name,'update_available':false,'model_id':info.model_id,'description':info.definition.description,'software_build_id':info.software_build_id,'vendor':info.definition.vendor};
			}
			
			const existingDevice = this.getDevice(info.friendly_name);
	    if (existingDevice && existingDevice.modelId === info.model_id) {
	      if(this.config.debug){
					console.info(`Device ${info.friendly_name} already exists`);
				}
	      return;
	    }

	    let deviceDefinition = Devices[info.model_id];

	    if (!deviceDefinition) {
	      const detectedDevice = this.exposesDeviceGenerator.generateDevice(info);
	      if (detectedDevice) {
	        deviceDefinition = detectedDevice;
	        if(this.config.debug){
						console.info(`Device ${info.friendly_name} created from Exposes API`);
					}
	      }
	    } else {
	      if(this.config.debug){
					console.info(`Device ${info.friendly_name} created from devices.js`);
				}
	    }

	    if (deviceDefinition) {
				//console.log("adding device to thing");
	      const device = new MqttDevice(this, info.friendly_name, info.model_id, deviceDefinition);
	      this.handleDeviceAdded(device);
				//console.log("handleDeviceAdded called");
	    }
    }
    catch (error){
    	console.log("Error in addDevice: " + error);
    }
		
  }
	
	
	
	// Sometimes incoming date has values that are not reflected in existing properties. 
	// In those cases, this will attempts to add the missing properties.
	attempt_new_property(device_id,key,value){
		if(this.config.debug){
			console.log("in attempt_new_property for device: " + device_id + " and key: " + key);
			console.log(value);
		}
		
		var type = "string";
		if(Number.isFinite(value)){
			type = "number";
		}
		else if(typeof value === 'boolean'){
			type = "boolean";
		}
		
		var desc = {'title': this.applySentenceCase(key),'description':key,'readOnly':true,'type':type};
		
		var device = this.getDevice(device_id);
    const property = new MqttProperty(device, key, desc);
    device.properties.set(key, property);
		if(this.config.debug){
			console.log("new property should now be generated");
		}
		
		this.handleDeviceAdded(device);
		if(this.config.debug){
			console.log("- handleDeviceAdded has been called again");
		}
	}
	
	
	
  removeDevice(deviceId) {
	  if(this.config.debug){
			console.log("Removing device: " + deviceId);
		}
    return new Promise((resolve, reject) => {
      const device = this.devices[deviceId];
      if (device) {
        this.handleDeviceRemoved(device);
        resolve(device);
				
				try{
					this.client.publish(`${this.config.prefix}/bridge/request/device/remove`,'{"id": "' + deviceId + '"}');
				}
				catch (error){
					console.log(error);
				}
				
      } else {
        reject(`Device: ${deviceId} not found.`);
      }
    });
  }
  
	

  startPairing(_timeoutSeconds) {
    console.log('in startPairing');
		
		this.client.publish(`${this.config.prefix}/bridge/request/permit_join`,'{"value": true}');

    this.client.publish(`${this.config.prefix}/bridge/config/devices/get`);
    // TODO: Set permitJoin, and cancel pairing based on a separate timer so the devices have a bit longer to pair.
  }



  cancelPairing() {
    if(this.config.debug){
			console.log('in cancelPairing');
		}
		//this.client.publish(`${this.config.prefix}/bridge/request/permit_join`,'{"value": false}'); // timeout is too quick for some Zigbee devices
  }
	
	
	
  unload() {
		if(this.config.debug){
			console.log("in unload");
		}
		this.stop_zigbee2mqtt();
		console.log("zigbee2mqtt should now be stopped. Goodbye.");
    return super.unload();
  }
	
	
	
	applySentenceCase(title) {
		//console.log("Capitalising");
		if(title.toLowerCase() == "linkquality"){
			return "Link quality";
		}
		title = title.replace(/_/g, ' ');
		if(typeof title == "undefined"){
			title = "Unknown";
		}
		//console.log(title);
		return title.charAt(0).toUpperCase() + title.substr(1).toLowerCase();

	}
	
}


class MqttDevice extends Device {
  constructor(adapter, id, modelId, description) {
    super(adapter, id);
    this.name = description.name;
    this['@type'] = description['@type'];
    this.modelId = modelId;
    for (const [name, desc] of Object.entries(description.actions || {})) {
      this.addAction(name, desc);
    }
    for (const [name, desc] of Object.entries(description.properties || {})) {
      const property = new MqttProperty(this, name, desc);
      this.properties.set(name, property);
    }
    for (const [name, desc] of Object.entries(description.events || {})) {
      this.addEvent(name, desc);
    }
  }

  async performAction(action) {
    action.start();
    this.adapter.publishMessage(`${this.id}/set`, {
      [action.name]: action.input,
    });
    action.finish();
  }
}


class MqttProperty extends Property {
  constructor(device, name, propertyDescription) {
    super(device, name, propertyDescription);
    this.setCachedValue(propertyDescription.value);
    this.device.notifyPropertyChanged(this);
    this.options = propertyDescription;
  }
	
	
  setValue(value) {
  	if(this.device.adapter.config.debug){
			console.log("in setValue, where value = " + value + " and this.options: ");
			console.log(this.options);
		}
	
		/*
		// For now, creating extra state properties from enum that can actually be toggled is a bit complex. Sticking with read-only for now.
		if(this.options.title == "Power state"){
			console.log("updating extra Power State property");

      const property = this.device.findProperty(this.options.title);
      if (!property) {
				return;
			}
			extra_value
			if(value.toLowerCase() == 'on'){
				
			}
      const {fromMqtt = identity} = property.options;
      property.setCachedValue(fromMqtt(msg[key]));
      device.notifyPropertyChanged(property);
			return;
		}
		*/
	
	
    return new Promise((resolve, reject) => {
      super
        .setValue(value)
        .then((updatedValue) => {
          const {toMqtt = identity} = this.options;
					
					if(typeof this.options["type"] == "string" && this.options["title"] == "Color" ){ // https://github.com/EirikBirkeland/hex-to-xy
						if(this.device.adapter.config.debug){
							console.log("translating HEX color to XY (cie color space)");
						}
						var cie_colors = HEXtoXY(updatedValue);
						const x = cie_colors[0];
						const y = cie_colors[1];
						updatedValue = {"x":x, "y":y};
						if(this.device.adapter.config.debug){
							console.log("color translated to: " + updatedValue);
						}
					}
					
					if(typeof this.options["origin"] == "string"){
						if(this.options["origin"] == "exposes-scaled-percentage"){
							updatedValue = percentage_to_integer(updatedValue,this.options["origin_maximum"]);
							if(this.device.adapter.config.debug){
								console.log("- exposes-scaled-percentage -> updatedValue scaled back to: " + updatedValue);
							}
						}
					}
					
          this.device.adapter.publishMessage(`${this.device.id}/set`, {
            [this.name]: toMqtt(updatedValue),
          });
          resolve(updatedValue);
          this.device.notifyPropertyChanged(this);
        })
        .catch((err) => {
          reject(err);
        });
    });
  }

}


function loadAdapter(addonManager, manifest, _errorCallback) {
  new ZigbeeMqttAdapter(addonManager, manifest);
}


function integer_to_percentage(byte, maximum){
	const factor = maximum / 100;
	const percentage = Math.floor(byte/factor);
	return percentage;
}


function percentage_to_integer(percentage, maximum){
	const factor = maximum / 100;
	var byte = Math.floor(percentage*factor);
	if(byte > maximum){
		console.log("percentage_to_integer overflowed");
		byte = maximum;
	}
	return byte;
}


function HEXtoXY(hex){ // thanks to https://stackoverflow.com/questions/20283401/php-how-to-convert-rgb-color-to-cie-1931-color-specification
	//console.log("in HEXtoXY, hex = " + hex);
	hex = hex.replace(/^#/, '');
  const aRgbHex = hex.match(/.{1,2}/g);
	var red = parseInt(aRgbHex[0], 16);
	var green = parseInt(aRgbHex[1], 16);
	var blue = parseInt(aRgbHex[2], 16);
	
	red = (red > 0.04045) ? Math.pow((red + 0.055) / (1.0 + 0.055), 2.4) : (red / 12.92);
  green = (green > 0.04045) ? Math.pow((green + 0.055) / (1.0 + 0.055), 2.4) : (green / 12.92);
  blue = (blue > 0.04045) ? Math.pow((blue + 0.055) / (1.0 + 0.055), 2.4) : (blue / 12.92);
  var X = red * 0.664511 + green * 0.154324 + blue * 0.162028;
  var Y = red * 0.283881 + green * 0.668433 + blue * 0.047685;
  var Z = red * 0.000088 + green * 0.072310 + blue * 0.986039;
  var fx = X / (X + Y + Z);
  var fy = Y / (X + Y + Z);
	//console.log("fx.toPrecision(2) = ");
	//console.log( fx.toPrecision(2) );
	
  return [fx.toPrecision(2),fy.toPrecision(2)];
}


function XYtoHEX(x, y, bri){ // and needs brightness too
  const z = 1.0 - x - y;

  const Y = bri / 255.0; // Brightness of lamp
  const X = (Y / y) * x;
  const Z = (Y / y) * z;
  var r = X * 1.612 - Y * 0.203 - Z * 0.302;
  var g = -X * 0.509 + Y * 1.412 + Z * 0.066;
  var b = X * 0.026 - Y * 0.072 + Z * 0.962;
  r = r <= 0.0031308 ? 12.92 * r : (1.0 + 0.055) * Math.pow(r, (1.0 / 2.4)) - 0.055;
  g = g <= 0.0031308 ? 12.92 * g : (1.0 + 0.055) * Math.pow(g, (1.0 / 2.4)) - 0.055;
  b = b <= 0.0031308 ? 12.92 * b : (1.0 + 0.055) * Math.pow(b, (1.0 / 2.4)) - 0.055;

  const maxValue = Math.max(r,g,b);
  r /= maxValue;
  g /= maxValue;
  b /= maxValue;
  r = r * 255;   if (r < 0) { r = 255 };
  g = g * 255;   if (g < 0) { g = 255 };
  b = b * 255;   if (b < 0) { b = 255 };

  r = Math.round(r).toString(16);
  g = Math.round(g).toString(16);
  b = Math.round(b).toString(16);
	
  if (r.length < 2)
      r="0"+r;        
  if (g.length < 2)
      g="0"+g;        
  if (b.length < 2)
      b="0"+r;
	
  return "#"+r+g+b;
}



module.exports = loadAdapter;

