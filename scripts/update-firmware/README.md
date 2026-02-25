# https://wiki.evilmadscientist.com/Updating_EBB_firmware

# Get latest at
# https://github.com/evil-mad/EggBot/tree/master/EBB_firmware/Releases/app/EBF_v303/EBF_v303.hex

# Get mphidflash that can't be ran on ARM 
# curl https://github.com/EmbeddedMan/mphidflash/tree/master/binaries/mphidflash-1.6-linux-64 -o mphidflash
# curl https://github.com/EmbeddedMan/mphidflash/tree/master/binaries/mphidflash-1.6-osx-64 -o mphidflash
# chmod +x mphidflash

# Put your EBB in 'bootloader mode' by doing one of the following: 
#     Press the PRG button and hold it down while you press and release the RST button. Then release the PRG button.
#     If you are using the Inkscape based AxiDraw software, use the "Enter EBB Bootloader mode" option from the Manual tab of AxiDraw Control
#     If you are using the CLI based AxiDraw software, use the corresponding bootload option.
# $ axicli -m manual -M bootload

# Verify by flashing lights then:
# mphidflash -w EBF_v303.hex -r
