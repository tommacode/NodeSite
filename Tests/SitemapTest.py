# #########
# This test will go through sitemap.xml and check if all the links are valid
# #########
import requests

# headers to make the program identifyable but in the same format as a mozilla user agent
headers = {
    'User-Agent': 'Mozilla/5.0 (SitemapBot) Bot/1.0'
}


domain = input("Enter the URL of the sitemap.xml file:")
r = requests.get(domain, headers=headers)
data = r.text

#Get the links from the xml file
links = data.split("<loc>")[1:]
links = [link.split("</loc>")[0] for link in links]

#Print a status update
print(f"{len(links)} links found in sitemap.xml")


invalidLinks = []
#Check if the links are valid
for link in links:
    r = requests.get(link, headers=headers)
    if r.status_code != 200:
        print(f"Link {link} is invalid")
        invalidLinks.append(link)

#Print a status update
print(f"{len(invalidLinks)} invalid links found")
print("These were the invalid links:")
print(invalidLinks)

