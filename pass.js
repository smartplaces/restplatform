var restify = require('restify');
var _ = require('underscore');
var fs = require('fs');
var mongojs = require('mongojs');
var createTemplate = require("passbook");

var mongoConnection = 'mongodb://smartplaces:EvystVtcnf@oceanic.mongohq.com:10091/smartplaces'; // || process.env.MONGOHQ_URL || 'localhost:3001/smartplaces';
var db = mongojs(mongoConnection,['smartplaces']);
var passes = db.collection('passes');

var http_port = process.env.PORT || '8080';
var https_port = '443';

var KEYS_FOLDER = "./keys/";
var KEYS_PASSWORD = "123456";
var IMAGE_FOLDER = "./images"

var http_server = restify.createServer({
  name:'http_restplatform'
});

initServer(http_server);

http_server.listen(http_port,function(){
  console.log('%s listening at %s',http_server.name,http_server.url);
});

function samplePassJSON(){
  return {
    formatVersion: 1,
    passTypeIdentifier: "pass.ru.smartplaces.coupon",
    teamIdentifier:     "Y77QB88576",
    webServiceURL: "http://sleepy-scrubland-4869.herokuapp.com/passws/",
    authenticationToken: "10AA10AA10AA10AA10AA10AA10AA10AA10AA10AA",
    organizationName: "SmartPlaces",
    description:   "Купон от SmartPlaces",
    backgroundColor:   "rgb(237,216,216)",
    foregroundColor: "rgb(247,7,65)",
    labelColor: "rgb(13,21,237)",

    serialNumber:  "SN"+new Date().getTime(),

    logoText: "Smar Coffe",

    barcode : {
      message : "1234567",
      format : "PKBarcodeFormatPDF417",
      messageEncoding : "utf-8"
    },

    coupon: {
      primaryFields : [
        {
          key : "offer",
          label : "-50%",
          value : "на американо"
        }
      ],
      secondaryFields : [
        {
          key : "addInfo",
          label : "Предложение для",
          value : "Всех посетителей"
        }
      ],
      backFields : [
        {
          "key" : "terms",
          "label" : "УСЛОВИЯ ИСПОЛЬЗОВАНИЯ",
          "value" : "Это купон создан компанией SmartPlaces и является ее собственностью."
        }
      ]
    }
  };
}

function createSamplePass(){
  var json = samplePassJSON();

  var template = createTemplate("coupon", {passTypeIdentifier:json.passTypeIdentifier, teamIdentifier:json.teamIdentifier});

  template.keys(KEYS_FOLDER, KEYS_PASSWORD);

  var pass = template.createPass(_.omit(json,'passTypeIdentifier','teamIdentifier'));

  pass.loadImagesFrom(IMAGE_FOLDER);

  pass.on("error", function(error) {
    console.error(error);
  });

  pass.on('end',function(){
    console.log('Pass with serial number '+json.serialNumber+' was created.');
  });

  console.log('Store pass to database...');
  passes.save({pass:json});

  return pass;
}

function initServer(server){

  server.use(restify.acceptParser(server.acceptable));
  server.use(restify.authorizationParser());
  server.use(restify.dateParser());
  server.use(restify.queryParser());
  server.use(restify.jsonp());
  server.use(restify.gzipResponse());
  server.use(restify.bodyParser());


  server.get('/', restify.serveStatic({
	  'directory': '.',
	  'default': 'index.html'
  }));

  server.get('/passws/', restify.serveStatic({
	  'directory': '.',
	  'default': 'index.html'
  }));

  server.get({path:'/passws/getSamplePass/:pass_name'},function (req, res, next){
    var pass = createSamplePass();
    console.log('Render pass...');
    console.log(pass);
    pass.render(res, function(error) {
      console.log('Pass have been rendered!');
      if (error){
        console.error(error);
        res.send(500);
      }
      res.send(200);
    });
  });

  server.post({path:'/passws/v1/devices/:device_id/registrations/:pass_type_id/:serial_number'},function (req, res, next){
    try{
      console.log('Handling registration request...');

      var authToken = req.header('Authorization');
      if (authToken) authToken = authToken.replace('ApplePass ','');
      var serialNumber = req.params.serial_number;
      var passType = req.params.pass_type_id;
      var deviceId = req.params.device_id;
      var pushToken = req.params.pushToken;

      console.log(authToken+","+serialNumber+","+passType+","+deviceId+","+pushToken);

      passes.findOne({'pass.passTypeIdentifier':passType,'pass.serialNumber':serialNumber,'pass.authenticationToken':authToken}, function (err,pass){
        if (pass){
          console.log('Pass for device was found!');
          if (_.indexOf(pass.registrations,deviceId) > -1){
            res.send(200);
          }else{
            passes.update({_id:pass._id},{$addToSet:{registrations:{deviceId:deviceId,pushToken:pushToken}}},{},function(err){
                if (err){
                  res.send(500);
                }else{
                  console.log('Pass was registered successfuly!');
                  res.send(201);
                }
            });
          }
        }else{
          console.log('Pass for device wasn\'t found!');
          res.send(401);
        }
      });
    }catch(ex){
      console.log(ex);
      res.send(200);
    }

  });

  server.get({path:'/passws/v1/devices/:device_id/registrations/:pass_type_id?'},function (req, res, next){
    console.log('Handling updates request...');

    var passType = req.params.pass_type_id;
    var deviceId = req.params.device_id;
    var passesUpdatedSince = req.params.passesUpdatedSince;


    passes.find({'registrations.deviceId':deviceId},function(err,docs){
      if (docs.length>0){
        var result = {
          lastUpdated: new Date().getTime(),
          serialNumbers: []
        }
        _.each(docs,function(d){
          if (d.passType === passType){
            if (passesUpdatedSince){
              if (!d.updatedAt || d.updatedAt > passesUpdatedSince){
                result.serialNumbers.append(d.serialNumber);
              }
            }else{
              result.serialNumbers.append(d.serialNumber);
            }
          }
        });

        if (result.serialNumbers.length > 0){
          res.send(200,result);
        }else{
          res.send(204);
        }
      }else{
        res.send(404);
      }
    });
  });

  server.del({path:'/passws/v1/devices/:device_id/registrations/:pass_type_id/:serial_number'},function (req, res, next){
    console.log('Handling unregistration request...')

    var authToken = req.header('Authorization');
    if (authToken) authToken = authToken.replace('ApplePass ','');
    var serialNumber = req.params.serial_number;
    var passType = req.params.pass_type_id;
    var deviceId = req.params.device_id;

    passes.remove({'pass.authenticationToken':authToken, 'pass.serialNumber':serialNumber, 'pass.passTypeIdentifier':passType, 'registrations.deviceId':deviceId},function(err,count){
      if (count > 0){
        res.send(200);
      }else{
        res.send(401);
      }
    });
  });

  server.get({path:'/passws/v1/passes/:pass_type_id/:serial_number'},function (req, res, next){
    console.log('Handling pass delivery request...');

    var authToken = req.header('Authorization');
    if (authToken) authToken = authToken.replace('ApplePass ','');
    var serialNumber = req.params.serial_number;
    var passType = req.params.pass_type_id;

    /*
    passes.findOne({'pass.authenticationToken':authToken,'pass.serialNumber':serialNumber,'pass.passTypeIdentifier':passType},function(err,pass){
      if (pass){
        // Send pass-file to response with mime type: 'application/vnd.apple.pkpass'
        res.send(200);
      }else{
        res.send(401);
      }
    });
    */
    res.send(401);
  });

  server.post({path:'passws/v1/log'},function (req, res, next){
    console.log('Handling log request...');
    var logs = req.params.logs;
    _.each(logs,function(log){
      db.collection('passbook_logs').insert({m:log});
    });
    res.send(200);
  });
}
